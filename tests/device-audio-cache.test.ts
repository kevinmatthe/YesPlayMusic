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
const resolution=(id:string):Resolution=>({trackID:id,status:'available',url:'https://cdn.example/audio.mp3?signature=temporary-secret',expiresAt:'2030-01-01T00:05:00Z',mediaSource:'unm:pyncmd',originTrackID:id,matchMethod:'provider_external_id',verification:'audio_prefix',reason:'external_source'})
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
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
  return {cache,base,store,fetcher,create,revoke,setOwner:(id:string)=>owner=session(id),advance:(ms:number)=>clock+=ms}
}

describe('persistent device audio at the API boundary',()=>{
 it('uses approved capacity defaults',()=>{expect(DEVICE_CACHE_BYTES).toBe(256*1024*1024);expect(DEVICE_TRACK_BYTES).toBe(64*1024*1024)})
 it('downloads once without credentials, persists verified complete bytes, and plays that same Blob',async()=>{
  const h=harness();const result=await h.cache.api.resolve('netease:11')
  expect(result.url).toMatch(/^blob:/);expect(result.reason).toContain('device_audio_cache');expect(h.base.resolve).toHaveBeenCalledWith('netease:11')
  expect(h.fetcher).toHaveBeenCalledTimes(1);expect(h.fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'no-store',mode:'cors'})
  const row=[...h.store.records.values()][0];expect(row.byteLength).toBe(audioBytes().length);expect(row.durationMs).toBe(canonicalMs);expect(row.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(row.namespace).not.toContain('server-owned-account');expect(JSON.stringify(row)).not.toMatch(/https:|signature|temporary-secret|expiresAt|cookie|bearer/i)
  expect(result.mediaSource).toBe('unm:pyncmd');expect(result.originTrackID).toBe('netease:11')
 })
 it('replays and recreates a document cache without another resolve or audio fetch, even after signed URL expiry',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');h.advance(10*60*1000)
  const repeated=await h.cache.api.resolve('netease:11');expect(Date.parse(repeated.expiresAt!)).toBeGreaterThan(Date.parse('2030-01-01T00:10:00Z'))
  const reloaded=createDeviceAudioCache(h.base,{store:h.store,fetcher:h.fetcher as typeof fetch,createObjectURL:()=> 'blob:new-document',origin:'https://music.example'})
  expect((await reloaded.api.resolve('netease:11')).url).toBe('blob:new-document')
  expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('single-flights simultaneous resolution and download for the same owner and stable ID',async()=>{
  const h=harness();const results=await Promise.all([h.cache.api.resolve('netease:11'),h.cache.api.resolve('netease:11')])
  expect(results[0].url).toBe(results[1].url);expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('isolates server owners and numeric IDs from different catalogues',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');await h.cache.api.resolve('kuwo:11');h.setOwner('server-owned-account-B');await h.cache.api.resolve('netease:11')
  expect(h.store.records.size).toBe(3);expect(new Set([...h.store.records.values()].map(r=>r.namespace)).size).toBe(2);expect(h.base.resolve).toHaveBeenCalledTimes(3)
 })
 it('evicts least recently used entries at the module capacity and keeps a recently replayed track',async()=>{
  const h=harness({maxBytes:audioBytes().length*2});await h.cache.api.resolve('netease:11');h.advance(10);await h.cache.api.resolve('netease:22');h.advance(10);await h.cache.api.resolve('netease:11');h.advance(10);await h.cache.api.resolve('netease:33')
  expect([...h.store.records.values()].map(r=>r.trackID).sort()).toEqual(['netease:11','netease:33'])
 })
 it('clears only the current verified account and retains its automatic-cache setting',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');h.setOwner('server-owned-account-B');await h.cache.api.resolve('netease:22');await h.cache.setEnabled(false);await h.cache.clear()
  expect([...h.store.records.values()].map(r=>r.trackID)).toEqual(['netease:11']);expect(h.cache.snapshot().enabled).toBe(false)
 })
 it('disables new downloads while allowing existing cached audio to replay',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');await h.cache.setEnabled(false)
  expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^blob:/);expect((await h.cache.api.resolve('netease:22')).url).toMatch(/^https:/);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('plays the already downloaded Blob if quota prevents persistence, with no second download',async()=>{
  const h=harness();h.store.save=async()=>{throw new DOMException('full','QuotaExceededError')};const result=await h.cache.api.resolve('netease:11')
  expect(result.url).toMatch(/^blob:/);expect(result.reason).toContain('device_audio_memory');expect(h.fetcher).toHaveBeenCalledTimes(1);expect(h.cache.snapshot().message).toContain('未保存')
 })
 it('leaves direct playback available when storage is disabled or cross-origin fetch is denied',async()=>{
  const h=harness();h.store.enabled=async()=>{throw new Error('storage disabled')};expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^https:/);expect(h.fetcher).not.toHaveBeenCalled()
  const cors=harness();cors.fetcher.mockRejectedValue(new TypeError('CORS'));expect((await cors.cache.api.resolve('netease:11')).url).toMatch(/^https:/);expect(cors.store.records.size).toBe(0);expect(cors.cache.snapshot().message).toContain('未缓存')
 })
 it.each([206,403])('never persists an incomplete or rejected HTTP %i response',async status=>{
  const h=harness();h.fetcher.mockImplementation(async()=>new Response(audioBytes(),{status}));expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^https:/);expect(h.store.records.size).toBe(0)
 })
 it('does not upgrade a declared preview or unavailable source, or download a mismatched ID',async()=>{
  for(const result of [{...resolution('netease:11'),status:'preview' as const},{...resolution('netease:11'),status:'unavailable' as const,url:undefined},{...resolution('kuwo:11')}]){
   const h=harness();vi.mocked(h.base.resolve).mockResolvedValue(result);expect(await h.cache.api.resolve('netease:11')).toEqual(result);expect(h.fetcher).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0)
  }
 })
 it('marks complete but short media as preview without persisting it or discarding original source evidence',async()=>{
  const h=harness();vi.mocked(h.base.details).mockResolvedValue([{...track('netease:11'),durationMs:180000}]);const result=await h.cache.api.resolve('netease:11')
  expect(result.status).toBe('preview');expect(result.url).toMatch(/^blob:/);expect(result.reason).toBe('external_source');expect(result.mediaSource).toBe('unm:pyncmd');expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain('试听')
 })
 it('labels unverified complete-response bytes as memory-only, never as another direct stream or persisted cache',async()=>{
  const h=harness();h.fetcher.mockImplementation(async()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'audio/mp4'}}));const result=await h.cache.api.resolve('netease:11')
  expect(result.url).toMatch(/^blob:/);expect(result.reason).toBe('device_audio_memory:external_source');expect(result.mediaSource).toBe('unm:pyncmd');expect(h.store.records.size).toBe(0);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('enforces actual-byte limits even if Content-Length is absent',async()=>{
  const h=harness({maxTrackBytes:1000});expect((await h.cache.api.resolve('netease:11')).url).toMatch(/^https:/);expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain('上限')
 })
 it('never fills from our origin, MinIO delivery, a redirect to our host, or an unapproved remote host',async()=>{
  for(const changed of [{url:'https://music.example/audio.mp3'},{url:'https://cdn.example/minio.mp3',reason:'owned_minio_cache'},{url:'https://proxy.example/audio.mp3'}]){
   const h=harness({blockedAudioHosts:['proxy.example']});vi.mocked(h.base.resolve).mockResolvedValue({...resolution('netease:11'),...changed});const result=await h.cache.api.resolve('netease:11');expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.fetcher).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0)
  }
  const redirected=harness();redirected.fetcher.mockImplementation(async()=>{const response=new Response(audioBytes());Object.defineProperty(response,'url',{value:'https://music.example/audio.mp3'});return response});expect((await redirected.cache.api.resolve('netease:11')).url).toBeUndefined();expect(redirected.store.records.size).toBe(0)
  const unset=harness({externalAudioURL:undefined});await unset.cache.api.resolve('netease:11');expect(unset.fetcher).not.toHaveBeenCalled()
  const unknown=harness();vi.mocked(unknown.base.resolve).mockResolvedValue({...resolution('netease:11'),url:'https://unknown-cdn.example/audio.mp3'});expect((await unknown.cache.api.resolve('netease:11')).url).toBe('https://unknown-cdn.example/audio.mp3');expect(unknown.fetcher).not.toHaveBeenCalled()
 })
 it('leaves transport options to the direct-source integrator through an injectable resolver',async()=>{
  const remote=vi.fn(async(id:string)=>resolution(id)),h=harness({resolveRemote:remote});await h.cache.api.resolve('netease:11');expect(remote).toHaveBeenCalledWith('netease:11');expect(h.base.resolve).not.toHaveBeenCalled();expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('rejects operator delivery before preview, disabled-cache, and storage-failure fallbacks',async()=>{
  for(const mode of ['preview','disabled','storage']){
   const h=harness();if(mode==='disabled')await h.cache.setEnabled(false);if(mode==='storage')h.store.enabled=async()=>{throw new Error('no storage')}
   vi.mocked(h.base.resolve).mockResolvedValue({...resolution('netease:11'),status:mode==='preview'?'preview':'available',reason:'owned_minio_cache',url:'https://cdn.example/operator-object.mp3'})
   const result=await h.cache.api.resolve('netease:11');expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.fetcher).not.toHaveBeenCalled()
  }
 })
 it('retains stable IDs with dots and up to 180 external-ID characters',async()=>{
  const h=harness(),id='netease:'+('a'.repeat(178)+'.b');await h.cache.api.resolve(id);await h.cache.api.resolve(id);expect(h.fetcher).toHaveBeenCalledTimes(1);expect([...h.store.records.values()][0].trackID).toBe(id)
 })
 it('aborts the cache transport when a response cannot be used, before handing back direct playback',async()=>{
  const h=harness();let signal:AbortSignal|undefined;h.fetcher.mockImplementation(async(_url,options)=>{signal=options?.signal as AbortSignal;return new Response(audioBytes(),{status:206})})
  await h.cache.api.resolve('netease:11');expect(signal?.aborted).toBe(true)
 })
 it('checks stored digest and byte length before returning cached bytes',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');const row=[...h.store.records.values()][0],tampered=audioBytes();tampered[100]=1;row.blob=new Blob([tampered])
  await h.cache.api.resolve('netease:11');expect(h.base.resolve).toHaveBeenCalledTimes(2);expect(h.fetcher).toHaveBeenCalledTimes(2)
 })
 it('cancels unneeded downloads on a different selection without letting late data overwrite it',async()=>{
  const h=harness(),pending=deferred<Response>(),started=deferred<void>();let firstSignal:AbortSignal|undefined
  h.fetcher.mockImplementationOnce(async(_url,options)=>{firstSignal=options?.signal as AbortSignal;started.resolve();return pending.promise})
  const first=h.cache.api.resolve('netease:11').catch(error=>error);await started.promise;await h.cache.api.resolve('netease:22');expect(firstSignal?.aborted).toBe(true)
  pending.resolve(new Response(audioBytes()));expect((await first).name).toBe('AbortError');expect([...h.store.records.values()].map(r=>r.trackID)).toEqual(['netease:22'])
 })
 it('invalidates old-account downloads during an explicit identity switch',async()=>{
  const h=harness(),pending=deferred<Response>(),started=deferred<void>();h.fetcher.mockImplementationOnce(async()=>{started.resolve();return pending.promise})
  const first=h.cache.api.resolve('netease:11').catch(error=>error);await started.promise;h.setOwner('server-owned-account-B');await h.cache.api.recover('private-recovery-code')
  pending.resolve(new Response(audioBytes()));expect((await first).name).toBe('AbortError');expect(h.store.records.size).toBe(0)
  await h.cache.api.resolve('netease:11');expect([...h.store.records.values()][0].namespace).not.toContain('private-recovery-code')
 })
 it('does not read a previous account cache after /me rejects the current cookie',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');vi.mocked(h.base.me).mockRejectedValue(new Error('session expired'));await expect(h.cache.api.resolve('netease:11')).rejects.toThrow('session expired');expect(h.base.resolve).toHaveBeenCalledTimes(1)
 })
 it('single-flights across document instances when a shared browser lock is available',async()=>{
  const h=harness();let tail=Promise.resolve();const lock=async<T>(_name:string,action:()=>Promise<T>):Promise<T>=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;try{return await action()}finally{release()}}
  const options={store:h.store,fetcher:h.fetcher as typeof fetch,createObjectURL:()=> 'blob:other-document',origin:'https://music.example',externalAudioURL:(url:URL)=>url.hostname==='cdn.example',lock}
  const first=createDeviceAudioCache(h.base,options),second=createDeviceAudioCache(h.base,options)
  await Promise.all([first.api.resolve('netease:11'),second.api.resolve('netease:11')]);expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
 it('keeps verified identity and its cache after an unsuccessful connection or a same-user profile refresh',async()=>{
  const h=harness();await h.cache.api.resolve('netease:11');vi.mocked(h.base.exchangeFeishu).mockRejectedValue(new Error('code rejected'))
  await expect(h.cache.api.exchangeFeishu('never-persist-this-code')).rejects.toThrow('code rejected');await h.cache.api.refreshFeishuProfile('another-private-code');await h.cache.api.resolve('netease:11')
  expect(h.base.resolve).toHaveBeenCalledTimes(1);expect(JSON.stringify([...h.store.records.values()])).not.toContain('private-code')
 })
 it('rejects a late old /me response after an explicit account switch without reverting the new namespace',async()=>{
  const h=harness(),old=deferred<Session>();vi.mocked(h.base.me).mockImplementationOnce(()=>old.promise)
  const pending=h.cache.api.resolve('netease:11').catch(error=>error);h.setOwner('server-owned-account-B');await h.cache.api.recover('recovery-code');old.resolve(session())
  expect((await pending).name).toBe('AbortError');await h.cache.api.resolve('netease:11');expect(h.store.records.size).toBe(1);expect(h.base.resolve).toHaveBeenCalledTimes(1)
 })
 it('does not refill after clear while an older resolve or metadata request is still waiting',async()=>{
  for(const stage of ['resolve','details']){
   const h=harness(),pending=deferred<Resolution|Track[]>(),started=deferred<void>()
   if(stage==='resolve')vi.mocked(h.base.resolve).mockImplementationOnce(async()=>{started.resolve();return await pending.promise as Resolution})
   else vi.mocked(h.base.details).mockImplementationOnce(async()=>{started.resolve();return await pending.promise as Track[]})
   const work=h.cache.api.resolve('netease:11').catch(error=>error);await started.promise;await h.cache.clear();pending.resolve(stage==='resolve'?resolution('netease:11'):[track('netease:11')])
   expect((await work).name).toBe('AbortError');expect(h.fetcher).not.toHaveBeenCalled();expect(h.store.records.size).toBe(0);expect(h.cache.snapshot().message).toContain('取消')
  }
 })
 it('cannot bind a late profile result or older recovery result over a newer verified account',async()=>{
  for(const action of ['profile','recover']){
   const h=harness(),pending=deferred<Session>();await h.cache.api.me()
   if(action==='profile')vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>pending.promise)
   else vi.mocked(h.base.recover).mockImplementationOnce(()=>pending.promise)
   const first=(action==='profile'?h.cache.api.refreshFeishuProfile('profile-code'):h.cache.api.recover('old-code')).catch(error=>error)
   h.setOwner('server-owned-account-B');await h.cache.api.recover('new-code');pending.resolve(session());expect((await first).name).toBe('AbortError')
   await h.cache.api.resolve('netease:11');expect(h.store.records.size).toBe(1)
  }
 })
 it('rejects an old profile when /me implicitly changes owner while the new namespace settings are pending',async()=>{
  const h=harness(),oldProfile=deferred<Session>(),bSettings=deferred<boolean>(),bBindingStarted=deferred<void>()
  const verified=(id:string):Session=>({...session(id),user:{id,kind:'feishu'}})
  const a=verified('verified-account-A'),b=verified('verified-account-B');let serverSession=a
  vi.mocked(h.base.me).mockImplementation(async()=>serverSession)
  await h.cache.api.resolve('netease:11')
  const aRecord=[...h.store.records.values()][0],reads=vi.spyOn(h.store,'get')
  h.store.enabled=async namespace=>{if(namespace!==aRecord.namespace){bBindingStarted.resolve();return bSettings.promise}return true}
  vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>oldProfile.promise)
  const profile=h.cache.api.refreshFeishuProfile('old-profile-code').catch(error=>error)
  serverSession=b // Another tab changed the cookie; no recover/exchange invalidation.
  const playback=h.cache.api.resolve('netease:11').catch(error=>error);await bBindingStarted.promise
  oldProfile.resolve(a);const profileResult=await profile;bSettings.resolve(true);const result=await playback
  expect(reads.mock.calls.some(([key])=>key===aRecord.key),'B must not read the warmed A namespace').toBe(false)
  expect(profileResult.name).toBe('AbortError');expect(result.status).toBe('available')
  expect(h.base.resolve).toHaveBeenCalledTimes(2);expect(h.fetcher).toHaveBeenCalledTimes(2)
  expect(new Set([...h.store.records.values()].map(row=>row.namespace)).size).toBe(2)
 })
 it('invalidates an old profile token across implicit A to B to A owner bindings',async()=>{
  const h=harness(),oldProfile=deferred<Session>();await h.cache.api.me()
  vi.mocked(h.base.refreshFeishuProfile).mockImplementationOnce(()=>oldProfile.promise)
  const profile=h.cache.api.refreshFeishuProfile('old-profile-code').catch(error=>error)
  h.setOwner('server-owned-account-B');await h.cache.api.me();h.setOwner('server-owned-account-A');await h.cache.api.me()
  oldProfile.resolve(session());expect((await profile).name).toBe('AbortError')
 })
 it('explains an explicitly cancelled preparation and hands back the same external URL when caching is turned off',async()=>{
  const h=harness(),started=deferred<void>();h.fetcher.mockImplementationOnce(async(_url,options)=>new Promise<Response>((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')));started.resolve()}))
  const work=h.cache.api.resolve('netease:11');await started.promise;await h.cache.setEnabled(false);expect((await work).url).toBe(resolution('netease:11').url);expect(h.cache.snapshot().message).toContain('取消');expect(h.store.records.size).toBe(0);expect(h.fetcher).toHaveBeenCalledTimes(1)
 })
})

class TestAudio extends EventTarget {
 src='';currentTime=0;duration=canonicalMs/1000;volume=1;paused=true;preload='';error=null
 get currentSrc(){return this.src}load(){}pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}async play(){this.paused=false;this.dispatchEvent(new Event('play'))}
 removeAttribute(){this.src=''}
}
describe('device media leases preserve the existing player recovery budget',()=>{
 it('marks a broken local Blob before original recover, re-resolves the same ID once and restores position',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement)
  const player=createPlayer({api:h.cache.api,audioFactory:()=>audio as unknown as HTMLAudioElement,storage:{getItem:()=>null,setItem(){},removeItem(){}}})
  await player.initialize();await player.playTracks([track('netease:11')]);audio.dispatchEvent(new Event('loadedmetadata'));audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'));const old=audio.src
  audio.dispatchEvent(new Event('error'));await vi.waitFor(()=>expect(h.base.resolve).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(audio.src).not.toBe(old));audio.dispatchEvent(new Event('loadedmetadata'));expect(audio.currentTime).toBe(2);expect(player.currentTrack?.id).toBe('netease:11')
  audio.dispatchEvent(new Event('error'));await vi.waitFor(()=>expect(player.state.status).toContain('停止重试'));expect(h.base.resolve).toHaveBeenCalledTimes(2);player.dispose();h.cache.dispose()
 })
 it('releases detached Blob URLs at source changes and all leases on account changes or disposal',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement)
  audio.src=(await h.cache.api.resolve('netease:11')).url!;audio.dispatchEvent(new Event('loadstart'));const old=audio.src
  audio.src=(await h.cache.api.resolve('netease:22')).url!;audio.dispatchEvent(new Event('loadstart'));await Promise.resolve();expect(h.revoke).toHaveBeenCalledWith(old)
  const active=audio.src;h.setOwner('server-owned-account-B');await h.cache.api.me();expect(h.revoke).toHaveBeenCalledWith(active);expect(audio.paused).toBe(true);h.cache.dispose()
 })
 it('retains currently playing bytes during a transient identity-network failure but refuses a new cache read',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement);audio.src=(await h.cache.api.resolve('netease:11')).url!;const active=audio.src
  vi.mocked(h.base.me).mockRejectedValue(Object.assign(new Error('temporarily offline'),{status:503}));await expect(h.cache.api.me()).rejects.toThrow('temporarily offline')
  expect(audio.src).toBe(active);expect(h.revoke).not.toHaveBeenCalledWith(active);await expect(h.cache.api.resolve('netease:11')).rejects.toThrow();expect(h.base.resolve).toHaveBeenCalledTimes(1)
 })
 it('clears persistent entries without interrupting the active Blob lease',async()=>{
  const h=harness(),audio=new TestAudio();h.cache.bindAudio(audio as unknown as HTMLAudioElement);audio.src=(await h.cache.api.resolve('netease:11')).url!;const active=audio.src;await h.cache.clear()
  expect(h.store.records.size).toBe(0);expect(audio.src).toBe(active);expect(h.revoke).not.toHaveBeenCalledWith(active)
 })
})
