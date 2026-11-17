import { describe, expect, it, vi } from 'vitest'
import { createDeviceAudioCache, DEVICE_CACHE_BYTES, DEVICE_TRACK_BYTES } from '../src/core/device-audio-cache'
import type { DeviceAudioRecord, DeviceAudioStore } from '../src/core/device-audio-cache-store'
import type { MusicApi, Resolution, Session, Track } from '../src/core/types'
import { createPlayer } from '../src/core/player'

const audioBytes = () => {
 const bytes=new Uint8Array(417*200)
 for(let p=0;p<bytes.length;p+=417)bytes.set([0xff,0xfb,0x90,0],p)
 return bytes
}
const canonicalMs=Math.floor(200*1152*1000/44100)
const session=(id='server-owned-account-A'):Session=>({user:{id,kind:'guest'},expiresAt:'2099-01-01T00:00:00Z'})
const track=(id:string):Track=>({id,source:id.split(':')[0],externalID:id.split(':')[1],title:'Test metadata',artist:'QA',album:'',picture:'',durationMs:canonicalMs})
const resolution=(id:string):Resolution=>({trackID:id,status:'available',url:'https://cdn.example/'+encodeURIComponent(id)+'.mp3?signature=temporary-secret',expiresAt:'2030-01-01T00:05:00Z',mediaSource:'unm:pyncmd',originTrackID:id,matchMethod:'provider_external_id',verification:'audio_prefix',reason:'external_source'})
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
class TestAudio extends EventTarget {
 src='';currentTime=0;duration=canonicalMs/1000;volume=1;paused=true;preload='';error=null;bufferEnd=0
 get currentSrc(){return this.src}
 get buffered(){return {length:this.bufferEnd?1:0,start:()=>0,end:()=>this.bufferEnd}}
 load(){}pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
 async play(){this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'))}
 full(){this.bufferEnd=this.duration;this.dispatchEvent(new Event('progress'))}
 removeAttribute(){this.src=''}
}
class MemoryStore implements DeviceAudioStore {
 records=new Map<string,DeviceAudioRecord>();settings=new Map<string,boolean>()
 async get(key:string){return this.records.get(key)}
 async list(){return [...this.records.values()].map(({blob:_,source:__,digest:___,...rest})=>rest)}
 async save(record:DeviceAudioRecord,budget:number){
  if(record.byteLength>budget)throw new Error('cache_limit')
  const rows=[...this.records.values()].filter(r=>r.key!==record.key).sort((a,b)=>a.lastUsedAt-b.lastUsedAt)
  let size=rows.reduce((n,r)=>n+r.byteLength,0)+record.byteLength
  while(size>budget&&rows.length){const r=rows.shift()!;this.records.delete(r.key);size-=r.byteLength}
  this.records.set(record.key,record)
 }
 async touch(key:string,at:number){const row=this.records.get(key);if(row)row.lastUsedAt=at}
 async remove(key:string){this.records.delete(key)}
 async clear(namespace:string){for(const [key,row]of this.records)if(row.namespace===namespace)this.records.delete(key)}
 async enabled(namespace:string){return this.settings.get(namespace)??true}
 async setEnabled(namespace:string,value:boolean){this.settings.set(namespace,value)}
}
function harness(options:Record<string,unknown>={}){
 const store=new MemoryStore();let owner=session(),clock=Date.parse('2030-01-01T00:00:00Z'),nextURL=0
 const base={me:vi.fn(async()=>owner),ensureGuest:vi.fn(async()=>owner),details:vi.fn(async(ids:string[])=>ids.map(track)),resolve:vi.fn(async(id:string)=>resolution(id)),recover:vi.fn(async()=>owner),exchangeFeishu:vi.fn(async()=>owner),refreshFeishuProfile:vi.fn(async()=>owner),logout:vi.fn(async()=>{}),queue:vi.fn(async()=>({revision:0,trackIDs:[],currentIndex:0,positionMs:0})),saveQueue:vi.fn(async(_device:string,q:unknown)=>q),lyrics:vi.fn(async(id:string)=>({trackID:id,lrc:'',translatedLrc:''})),recordHistory:vi.fn(async()=>{})} as unknown as MusicApi
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(audioBytes(),{headers:{'Content-Type':'audio/mpeg'}}))
 const revoke=vi.fn(),create=vi.fn((_blob:Blob)=>'blob:test-'+(++nextURL))
 const cache=createDeviceAudioCache(base,{store,fetcher:fetcher as typeof fetch,now:()=>clock,createObjectURL:create,revokeObjectURL:revoke,origin:'https://music.example',externalAudioURL:url=>url.hostname==='cdn.example',...options})
 const audio=new TestAudio();cache.bindAudio(audio as unknown as HTMLAudioElement)
 async function buffered(result:Resolution){audio.src=result.url||'';audio.bufferEnd=0;audio.dispatchEvent(new Event('loadstart'));await audio.play();audio.full()}
 async function begin(id:string){const result=await cache.api.resolve(id);await buffered(result);return result}
 // Real cache lifecycle: resolve -> native URL -> playing/full progress -> save.
 // No hidden second resolve: callers independently assert subsequent Blob use.
 async function warm(id:string){const result=await begin(id);await vi.waitFor(()=>expect(['streaming','downloading']).not.toContain(cache.snapshot().state));return result}
 return {cache,base,store,fetcher,create,revoke,audio,buffered,begin,warm,setOwner:(id:string)=>owner=session(id),advance:(ms:number)=>clock+=ms}
}

describe('persistent device audio at the API boundary',()=>{
 it('uses approved capacity defaults',()=>{expect(DEVICE_CACHE_BYTES).toBe(256*1024*1024);expect(DEVICE_TRACK_BYTES).toBe(64*1024*1024)})
 it('streams immediately, then saves verified complete bytes without replacing that stream',async()=>{
  const h=harness(),result=await h.cache.api.resolve('netease:11')
  expect(result.url).toBe(resolution('netease:11').url);expect(h.fetcher).not.toHaveBeenCalled();expect(h.base.details).not.toHaveBeenCalled();expect(h.base.resolve).toHaveBeenCalledWith('netease:11')
  await h.buffered(result);await vi.waitFor(()=>expect(h.store.records.size).toBe(1));expect(h.audio.src).toBe(result.url);expect(h.audio.paused).toBe(false)
  expect(h.fetcher).toHaveBeenCalledTimes(1);expect(h.fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'force-cache',mode:'cors',redirect:'error'})
  const row=[...h.store.records.values()][0];expect(row.byteLength).toBe(audioBytes().length);expect(row.durationMs).toBe(canonicalMs);expect(row.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(row.namespace).not.toContain('server-owned-account');expect(JSON.stringify(row)).not.toMatch(/https:|signature|temporary-secret|expiresAt|cookie|bearer/i)
  const next=await h.cache.api.resolve('netease:11');expect(next.url).toMatch(/^blob:/);expect(next.reason).toContain('device_audio_cache');expect(next.mediaSource).toBe('unm:pyncmd');expect(next.originTrackID).toBe('netease:11');h.cache.dispose()
 })
 it('replays and recreates a document cache without another resolve or audio fetch, even after signed URL expiry',async()=>{
  const h=harness();await h.warm('netease:11');h.advance(10*60*1000)
  const repeated=await h.cache.api.resolve('netease:11');expect(Date.parse(repeated.expiresAt!)).toBeGreaterThan(Date.parse('2030-01-01T00:10:00Z'))
  const reloaded=createDeviceAudioCache(h.base,{store:h.store,fetcher:h.fetcher as typeof fetch,createObjectURL:()=> 'blob:new-document',origin:'https://music.example'})
  expect((await reloaded.api.resolve('netease:11')).url).toBe('blob:new-document');expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(h.fetcher).toHaveBeenCalledTimes(1);reloaded.dispose();h.cache.dispose()
 })
 it('single-flights same-owner resolution immediately and fills once only after native playback',async()=>{
  const h=harness(),results=await Promise.all([h.cache.api.resolve('netease:11'),h.cache.api.resolve('netease:11')])
  expect(results[0].url).toBe(results[1].url);expect(results[0].url).toMatch(/^https:/);expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(h.fetcher).not.toHaveBeenCalled()
  await h.buffered(results[0]);h.audio.full();await vi.waitFor(()=>expect(h.store.records.size).toBe(1));expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('isolates server owners and numeric IDs from different catalogues',async()=>{
  const h=harness();await h.warm('netease:11');await h.warm('kuwo:11');h.setOwner('server-owned-account-B');await h.warm('netease:11')
  expect(h.store.records.size).toBe(3);expect(new Set([...h.store.records.values()].map(r=>r.namespace)).size).toBe(2);expect(h.base.resolve).toHaveBeenCalledTimes(3);h.cache.dispose()
 })
 it('evicts least recently used entries at capacity and keeps a recently replayed track',async()=>{
  const h=harness({maxBytes:audioBytes().length*2});await h.warm('netease:11');h.advance(10);await h.warm('netease:22');h.advance(10);await h.warm('netease:11');h.advance(10);await h.warm('netease:33')
  expect([...h.store.records.values()].map(r=>r.trackID).sort()).toEqual(['netease:11','netease:33']);h.cache.dispose()
 })
 it('clears only the current verified account and retains its automatic-cache setting',async()=>{
  const h=harness();await h.warm('netease:11');h.setOwner('server-owned-account-B');await h.warm('netease:22');await h.cache.setEnabled(false);await h.cache.clear()
  expect([...h.store.records.values()].map(r=>r.trackID)).toEqual(['netease:11']);expect(h.cache.snapshot().enabled).toBe(false);h.cache.dispose()
 })
 it('disables new downloads while allowing existing cached audio to replay',async()=>{
  const h=harness();await h.warm('netease:11');await h.cache.setEnabled(false)
  expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^blob:/);expect((await h.cache.api.resolve('netease:22')).url).toMatch(/^https:/);expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('keeps native playback when quota prevents background persistence without switching to another Blob',async()=>{
  const h=harness();h.store.save=async()=>{throw new DOMException('full','QuotaExceededError')};const result=await h.warm('netease:11')
  expect(result.url).toMatch(/^https:/);expect(h.audio.src).toBe(result.url);expect(h.audio.paused).toBe(false);expect(h.create).not.toHaveBeenCalled();expect(h.fetcher).toHaveBeenCalledTimes(1);expect(h.cache.snapshot().state).toBe('bypassed');expect(h.cache.snapshot().message).toContain('未保存');h.cache.dispose()
 })
 it('leaves direct playback available when storage is disabled or cross-origin fill is denied',async()=>{
  const h=harness();h.store.enabled=async()=>{throw new Error('storage disabled')};expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^https:/);expect(h.fetcher).not.toHaveBeenCalled();h.cache.dispose()
  const cors=harness();cors.fetcher.mockRejectedValue(new TypeError('CORS'));const result=await cors.warm('netease:11');expect(result.url).toMatch(/^https:/);expect(cors.audio.src).toBe(result.url);expect(cors.store.records.size).toBe(0);expect(cors.cache.snapshot().state).toBe('bypassed');expect(cors.cache.snapshot().message).toContain('未保存');cors.cache.dispose()
 })
 it.each([206,403])('never persists incomplete or rejected background HTTP %i',async status=>{
  const h=harness();h.fetcher.mockImplementation(async()=>new Response(audioBytes(),{status}));const result=await h.warm('netease:11');expect(result.url).toMatch(/^https:/);expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().state).toBe('bypassed');h.cache.dispose()
 })
 it('does not upgrade a preview/unavailable source or download a mismatched ID',async()=>{
  for(const result of [{...resolution('netease:11'),status:'preview' as const},{...resolution('netease:11'),status:'unavailable' as const,url:undefined},{...resolution('kuwo:11')}]){
   const h=harness();vi.mocked(h.base.resolve).mockResolvedValue(result);expect(await h.cache.api.resolve('netease:11')).toEqual(result);expect(h.fetcher).not.toHaveBeenCalled();expect(h.base.details).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);h.cache.dispose()
  }
 })
 it('reports short media after background validation without persisting or changing the original stream evidence',async()=>{
  const h=harness();vi.mocked(h.base.details).mockResolvedValue([{...track('netease:11'),durationMs:180000}]);const result=await h.warm('netease:11')
  expect(result.status).toBe('available');expect(result.url).toMatch(/^https:/);expect(result.reason).toBe('external_source');expect(result.mediaSource).toBe('unm:pyncmd');expect(h.audio.src).toBe(result.url);expect(h.create).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain('试听');h.cache.dispose()
 })
 it('rejects unverified complete-response bytes without replacing the native stream or claiming a cache',async()=>{
  const h=harness();h.fetcher.mockImplementation(async()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'audio/mp4'}}));const result=await h.warm('netease:11')
  expect(result.url).toMatch(/^https:/);expect(result.reason).toBe('external_source');expect(result.mediaSource).toBe('unm:pyncmd');expect(h.audio.src).toBe(result.url);expect(h.create).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);expect(h.fetcher).toHaveBeenCalledTimes(1);expect(h.cache.snapshot().state).toBe('bypassed');h.cache.dispose()
 })
 it('enforces actual-byte limits even without Content-Length',async()=>{
  const h=harness({maxTrackBytes:1000});expect((await h.warm('netease:11')).url).toMatch(/^https:/);expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain('上限');h.cache.dispose()
 })
 it('never fills from our origin, operator delivery, redirected host or an unapproved remote host',async()=>{
  for(const changed of [{url:'https://music.example/audio.mp3'},{url:'https://cdn.example/minio.mp3',reason:'owned_minio_cache'},{url:'https://proxy.example/audio.mp3'}]){
   const h=harness({blockedAudioHosts:['proxy.example']});vi.mocked(h.base.resolve).mockResolvedValue({...resolution('netease:11'),...changed});const result=await h.cache.api.resolve('netease:11');expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.fetcher).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);h.cache.dispose()
  }
  const redirected=harness();redirected.fetcher.mockImplementation(async()=>{const response=new Response(audioBytes());Object.defineProperty(response,'url',{value:'https://music.example/audio.mp3'});return response});const stream=await redirected.warm('netease:11');expect(redirected.audio.src).toBe(stream.url);expect(redirected.store.records.size).toBe(0);expect(redirected.cache.snapshot().state).toBe('bypassed');redirected.cache.dispose()
  const unset=harness({externalAudioURL:undefined});await unset.cache.api.resolve('netease:11');expect(unset.fetcher).not.toHaveBeenCalled();unset.cache.dispose()
  const unknown=harness();vi.mocked(unknown.base.resolve).mockResolvedValue({...resolution('netease:11'),url:'https://unknown-cdn.example/audio.mp3'});expect((await unknown.cache.api.resolve('netease:11')).url).toBe('https://unknown-cdn.example/audio.mp3');expect(unknown.fetcher).not.toHaveBeenCalled();unknown.cache.dispose()
 })
 it('leaves direct transport options to the injectable source resolver and fills only after actual playback',async()=>{
  const remote=vi.fn(async(id:string)=>resolution(id)),h=harness({resolveRemote:remote});const result=await h.cache.api.resolve('netease:11');expect(remote).toHaveBeenCalledWith('netease:11');expect(h.base.resolve).not.toHaveBeenCalled();expect(h.fetcher).not.toHaveBeenCalled();await h.buffered(result);await vi.waitFor(()=>expect(h.store.records.size).toBe(1));expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('rejects operator delivery before preview, disabled-cache and storage-failure fallback',async()=>{
  for(const mode of ['preview','disabled','storage']){
   const h=harness();if(mode==='disabled')await h.cache.setEnabled(false);if(mode==='storage')h.store.enabled=async()=>{throw new Error('no storage')}
   vi.mocked(h.base.resolve).mockResolvedValue({...resolution('netease:11'),status:mode==='preview'?'preview':'available',reason:'owned_minio_cache',url:'https://cdn.example/operator-object.mp3'})
   const result=await h.cache.api.resolve('netease:11');expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.fetcher).not.toHaveBeenCalled();h.cache.dispose()
  }
 })
 it('retains stable IDs containing dots and up to 180 external-ID characters',async()=>{
  const h=harness(),id='netease:'+('a'.repeat(178)+'.b');await h.warm(id);expect((await h.cache.api.resolve(id)).url).toMatch(/^blob:/);expect(h.fetcher).toHaveBeenCalledTimes(1);expect([...h.store.records.values()][0].trackID).toBe(id);h.cache.dispose()
 })
 it('aborts unusable background transport without handing a second URL to the current player',async()=>{
  const h=harness();let signal:AbortSignal|undefined;h.fetcher.mockImplementation(async(_url,options)=>{signal=options?.signal as AbortSignal;return new Response(audioBytes(),{status:206})})
  const result=await h.warm('netease:11');expect(signal?.aborted).toBe(true);expect(h.audio.src).toBe(result.url);expect(h.create).not.toHaveBeenCalled();h.cache.dispose()
 })
 it('checks stored digest and length before reuse, then validates a new background fill',async()=>{
  const h=harness();await h.warm('netease:11');const row=[...h.store.records.values()][0],tampered=audioBytes();tampered[100]=1;row.blob=new Blob([tampered])
  const again=await h.warm('netease:11');expect(again.url).toMatch(/^https:/);expect(h.base.resolve).toHaveBeenCalledTimes(2);expect(h.fetcher).toHaveBeenCalledTimes(2);expect([...h.store.records.values()][0].digest).toBe(row.digest);h.cache.dispose()
 })
 it('cancels background transport on another selection and discards late bytes',async()=>{
  const h=harness(),pending=deferred<Response>(),started=deferred<void>();let firstSignal:AbortSignal|undefined
  h.fetcher.mockImplementationOnce(async(_url,options)=>{firstSignal=options?.signal as AbortSignal;started.resolve();return pending.promise})
  const first=await h.begin('netease:11');await started.promise;const second=await h.warm('netease:22');expect(firstSignal?.aborted).toBe(true)
  pending.resolve(new Response(audioBytes()));await flush();expect(first.url).not.toBe(second.url);expect(h.audio.src).toBe(second.url);expect([...h.store.records.values()].map(r=>r.trackID)).toEqual(['netease:22']);h.cache.dispose()
 })
 it('invalidates old-account fill during explicit identity switching without persisting late bytes',async()=>{
  const h=harness(),pending=deferred<Response>(),started=deferred<void>();h.fetcher.mockImplementationOnce(async()=>{started.resolve();return pending.promise})
  await h.begin('netease:11');await started.promise;h.setOwner('server-owned-account-B');await h.cache.api.recover('private-recovery-code');pending.resolve(new Response(audioBytes()));await flush();expect(h.store.records.size).toBe(0)
  await h.warm('netease:11');expect([...h.store.records.values()][0].namespace).not.toContain('private-recovery-code');h.cache.dispose()
 })
 it('does not read a previous-account cache after /me rejects its cookie',async()=>{
  const h=harness();await h.warm('netease:11');vi.mocked(h.base.me).mockRejectedValue(new Error('session expired'));await expect(h.cache.api.resolve('netease:11')).rejects.toThrow('session expired');expect(h.base.resolve).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('lets document misses stream independently while a shared lock single-flights their later fill',async()=>{
  const h=harness();let tail=Promise.resolve();const lock=async<T>(_name:string,action:()=>Promise<T>):Promise<T>=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;try{return await action()}finally{release()}}
  const pending=deferred<Response>();h.fetcher.mockReturnValueOnce(pending.promise)
  const options={store:h.store,fetcher:h.fetcher as typeof fetch,createObjectURL:()=> 'blob:other-document',origin:'https://music.example',externalAudioURL:(url:URL)=>url.hostname==='cdn.example',lock}
  const first=createDeviceAudioCache(h.base,options),second=createDeviceAudioCache(h.base,options),a=new TestAudio(),b=new TestAudio();first.bindAudio(a as unknown as HTMLAudioElement);second.bindAudio(b as unknown as HTMLAudioElement)
  const streams=await Promise.all([first.api.resolve('netease:11'),second.api.resolve('netease:11')]);expect(streams.every(s=>s.url?.startsWith('https:'))).toBe(true);expect(h.base.resolve).toHaveBeenCalledTimes(2);expect(h.fetcher).not.toHaveBeenCalled()
  a.src=streams[0].url!;b.src=streams[1].url!;await a.play();a.full();await b.play();b.full();await vi.waitFor(()=>expect(h.fetcher).toHaveBeenCalledTimes(1));pending.resolve(new Response(audioBytes()));await vi.waitFor(()=>expect(h.store.records.size).toBe(1));expect((await second.api.resolve('netease:11')).url).toMatch(/^blob:/);expect(h.fetcher).toHaveBeenCalledTimes(1);first.dispose();second.dispose();h.cache.dispose()
 })
 it('retains cache after a rejected connection or same-user profile refresh',async()=>{
  const h=harness();await h.warm('netease:11');vi.mocked(h.base.exchangeFeishu).mockRejectedValue(new Error('code rejected'))
  await expect(h.cache.api.exchangeFeishu('never-persist-this-code')).rejects.toThrow('code rejected');await h.cache.api.refreshFeishuProfile('another-private-code');expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^blob:/)
  expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(JSON.stringify([...h.store.records.values()])).not.toContain('private-code');h.cache.dispose()
 })
 it('rejects late old /me after explicit account switch without reverting the new namespace',async()=>{
  const h=harness(),old=deferred<Session>();vi.mocked(h.base.me).mockImplementationOnce(()=>old.promise)
  const pending=h.cache.api.resolve('netease:11').catch(error=>error);h.setOwner('server-owned-account-B');await h.cache.api.recover('recovery-code');old.resolve(session())
  expect((await pending).name).toBe('AbortError');await h.warm('netease:11');expect(h.store.records.size).toBe(1);expect(h.base.resolve).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('does not refill after clear while an older resolve or metadata lookup is waiting',async()=>{
  for(const stage of ['resolve','details']){
   const h=harness(),pending=deferred<Resolution|Track[]>(),started=deferred<void>()
   if(stage==='resolve')vi.mocked(h.base.resolve).mockImplementationOnce(async()=>{started.resolve();return await pending.promise as Resolution})
   else vi.mocked(h.base.details).mockImplementationOnce(async()=>{started.resolve();return await pending.promise as Track[]})
   const work=stage==='resolve'?h.cache.api.resolve('netease:11').catch(error=>error):h.begin('netease:11');await started.promise;await h.cache.clear();pending.resolve(stage==='resolve'?resolution('netease:11'):[track('netease:11')])
   if(stage==='resolve')expect((await work).name).toBe('AbortError');else{const result=await work;expect(h.audio.src).toBe(result.url);expect(h.audio.paused).toBe(false)}
   await flush();expect(h.fetcher).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain(stage==='details'?'取消':'清空');h.cache.dispose()
  }
 })
 it('waits for an already-started save before clearing, so late persistence cannot repopulate the account',async()=>{
  const h=harness(),started=deferred<void>(),release=deferred<void>(),original=h.store.save.bind(h.store)
  h.store.save=async(row,budget)=>{started.resolve();await release.promise;await original(row,budget)}
  const stream=await h.begin('netease:11');await started.promise;let cleared=false;const clear=h.cache.clear().then(()=>cleared=true);await flush();expect(cleared).toBe(false)
  release.resolve();await clear;await flush();expect(h.store.records.size).toBe(0);expect(h.audio.src).toBe(stream.url);expect(h.audio.paused).toBe(false);expect(h.cache.snapshot().state).toBe('idle');h.cache.dispose()
 })
 it('cannot bind a late profile or older recovery over a newer verified owner',async()=>{
  for(const action of ['profile','recover']){
   const h=harness(),pending=deferred<Session>();await h.cache.api.me()
   if(action==='profile')vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>pending.promise)
   else vi.mocked(h.base.recover).mockImplementationOnce(()=>pending.promise)
   const first=(action==='profile'?h.cache.api.refreshFeishuProfile('profile-code'):h.cache.api.recover('old-code')).catch(error=>error)
   h.setOwner('server-owned-account-B');await h.cache.api.recover('new-code');pending.resolve(session());expect((await first).name).toBe('AbortError')
   await h.warm('netease:11');expect(h.store.records.size).toBe(1);h.cache.dispose()
  }
 })
 it('rejects an old profile while implicit owner-change settings are still pending',async()=>{
  const h=harness(),oldProfile=deferred<Session>(),bSettings=deferred<boolean>(),bBindingStarted=deferred<void>()
  const verified=(id:string):Session=>({...session(id),user:{id,kind:'feishu'}}),a=verified('verified-account-A'),b=verified('verified-account-B');let serverSession=a
  vi.mocked(h.base.me).mockImplementation(async()=>serverSession);await h.warm('netease:11');const aRecord=[...h.store.records.values()][0],reads=vi.spyOn(h.store,'get')
  h.store.enabled=async ns=>{if(ns!==aRecord.namespace){bBindingStarted.resolve();return bSettings.promise}return true}
  vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>oldProfile.promise);const profile=h.cache.api.refreshFeishuProfile('old-profile-code').catch(error=>error)
  serverSession=b;const playback=h.cache.api.resolve('netease:11');await bBindingStarted.promise;oldProfile.resolve(a);const profileResult=await profile;bSettings.resolve(true);const result=await playback
  expect(reads.mock.calls.some(([key])=>key===aRecord.key),'B must not read warmed A namespace').toBe(false);expect(profileResult.name).toBe('AbortError');expect(result.status).toBe('available');expect(h.fetcher).toHaveBeenCalledTimes(1)
  await h.buffered(result);await vi.waitFor(()=>expect(h.store.records.size).toBe(2));expect(h.base.resolve).toHaveBeenCalledTimes(2);expect(h.fetcher).toHaveBeenCalledTimes(2);expect(new Set([...h.store.records.values()].map(r=>r.namespace)).size).toBe(2);h.cache.dispose()
 })
 it('invalidates an old profile token across implicit A to B to A bindings',async()=>{
  const h=harness(),oldProfile=deferred<Session>();await h.cache.api.me();vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>oldProfile.promise)
  const profile=h.cache.api.refreshFeishuProfile('old-profile-code').catch(error=>error);h.setOwner('server-owned-account-B');await h.cache.api.me();h.setOwner('server-owned-account-A');await h.cache.api.me();oldProfile.resolve(session());expect((await profile).name).toBe('AbortError');h.cache.dispose()
 })
 it('cancels background fill when disabled but leaves the already returned stream playing',async()=>{
  const h=harness(),started=deferred<void>();h.fetcher.mockImplementationOnce(async(_url,options)=>new Promise<Response>((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')));started.resolve()}))
  const stream=await h.begin('netease:11');await started.promise;await h.cache.setEnabled(false);await flush();expect(h.audio.src).toBe(stream.url);expect(h.audio.paused).toBe(false);expect(h.cache.snapshot().message).toContain('取消');expect(h.store.records.size).toBe(0);expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
})

describe('device media leases preserve the existing player recovery budget',()=>{
 it('marks a broken cached Blob before NativePlayer recovery, re-resolves the same ID once and restores time',async()=>{
  const h=harness();await h.warm('netease:11');const audio=h.audio
  const player=createPlayer({api:h.cache.api,audioFactory:()=>audio as unknown as HTMLAudioElement,storage:{getItem:()=>null,setItem(){},removeItem(){}}})
  await player.initialize();await player.playTracks([track('netease:11')]);audio.dispatchEvent(new Event('loadedmetadata'));audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'));const old=audio.src;expect(old).toMatch(/^blob:/)
  audio.dispatchEvent(new Event('error'));await vi.waitFor(()=>expect(h.base.resolve).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(audio.src).toMatch(/^https:/));audio.dispatchEvent(new Event('loadedmetadata'));expect(audio.currentTime).toBe(2);expect(player.currentTrack?.id).toBe('netease:11');expect(h.fetcher).toHaveBeenCalledTimes(1)
  audio.dispatchEvent(new Event('error'));await vi.waitFor(()=>expect(player.state.status).toContain('停止重试'));expect(h.base.resolve).toHaveBeenCalledTimes(2);player.dispose();h.cache.dispose()
 })
 it('releases detached Blob URLs on source changes and every lease on identity change',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement);await h.warm('netease:11')
  audio.src=(await h.cache.api.resolve('netease:11')).url!;audio.dispatchEvent(new Event('loadstart'));const old=audio.src;expect(old).toMatch(/^blob:/)
  await h.warm('netease:22');audio.src=(await h.cache.api.resolve('netease:22')).url!;audio.dispatchEvent(new Event('loadstart'));await flush();expect(h.revoke).toHaveBeenCalledWith(old)
  const active=audio.src;h.setOwner('server-owned-account-B');await h.cache.api.me();expect(h.revoke).toHaveBeenCalledWith(active);expect(audio.paused).toBe(true);h.cache.dispose()
 })
 it('keeps active cached audio on transient identity network failure but refuses a new cache read',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement);await h.warm('netease:11');audio.src=(await h.cache.api.resolve('netease:11')).url!;await audio.play();const active=audio.src
  vi.mocked(h.base.me).mockRejectedValue(Object.assign(new Error('temporarily offline'),{status:503}));await expect(h.cache.api.me()).rejects.toThrow('temporarily offline')
  expect(audio.src).toBe(active);expect(audio.paused).toBe(false);expect(h.revoke).not.toHaveBeenCalledWith(active);await expect(h.cache.api.resolve('netease:11')).rejects.toThrow();expect(h.base.resolve).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('clears persistent bytes without interrupting the active Blob lease',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement);await h.warm('netease:11');audio.src=(await h.cache.api.resolve('netease:11')).url!;await audio.play();const active=audio.src;await h.cache.clear()
  expect(h.store.records.size).toBe(0);expect(audio.src).toBe(active);expect(audio.paused).toBe(false);expect(h.revoke).not.toHaveBeenCalledWith(active);h.cache.dispose()
 })
})
