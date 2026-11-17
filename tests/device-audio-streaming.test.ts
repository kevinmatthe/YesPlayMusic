import { describe, expect, it, vi } from 'vitest'
import { createDeviceAudioCache } from '../src/core/device-audio-cache'
import type { DeviceCacheOptions } from '../src/core/device-audio-cache'
import type { DeviceAudioRecord, DeviceAudioStore } from '../src/core/device-audio-cache-store'
import type { MusicApi, Resolution, Session, Track } from '../src/core/types'
const bytes=()=>{const b=new Uint8Array(417*200);for(let i=0;i<b.length;i+=417)b.set([0xff,0xfb,0x90,0],i);return b}
const durationMs=Math.floor(200*1152*1000/44100)
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
class Audio extends EventTarget {
 src='';currentTime=0;duration=durationMs/1000;paused=true;end=0
 get currentSrc(){return this.src}
 get buffered(){return {length:this.end?1:0,start:()=>0,end:()=>this.end}}
 pause(){this.paused=true}load(){}removeAttribute(){this.src=''}
 playing(){this.paused=false;this.dispatchEvent(new Event('playing'))}
 full(){this.end=this.duration;this.dispatchEvent(new Event('progress'))}
}
function setup(options:DeviceCacheOptions={}){
 const rows=new Map<string,DeviceAudioRecord>(),settings=new Map<string,boolean>();let owner='stream-A'
 const store:DeviceAudioStore={get:async k=>rows.get(k),list:async()=>[...rows.values()].map(({blob:_,source:__,digest:___,...r})=>r),save:vi.fn(async r=>{rows.set(r.key,r)}),touch:async()=>{},remove:async k=>{rows.delete(k)},clear:async ns=>{for(const[k,r]of rows)if(r.namespace===ns)rows.delete(k)},enabled:async ns=>settings.get(ns)??true,setEnabled:async(ns,v)=>{settings.set(ns,v)}}
 const session=():Session=>({user:{id:owner,kind:'guest'},expiresAt:'2099-01-01T00:00:00Z'})
 const track=(id:string):Track=>({id,source:'netease',externalID:id.split(':')[1],title:'Streaming test',artist:'QA',album:'',picture:'',durationMs})
 const remote=(id:string):Resolution=>({trackID:id,status:'available',url:'https://cdn.example/'+id+'.mp3',expiresAt:'2099-01-01T00:00:00Z',reason:'external_source',originTrackID:id,mediaSource:'unm:pyncmd'})
 const base={me:vi.fn(async()=>session()),resolve:vi.fn(async(id:string)=>remote(id)),details:vi.fn(async(ids:string[])=>ids.map(track)),recover:vi.fn(async()=>session()),logout:vi.fn(async()=>{})} as unknown as MusicApi
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(bytes(),{headers:{'Content-Type':'audio/mpeg'}}))
 const cache=createDeviceAudioCache(base,{store,fetcher:fetcher as typeof fetch,origin:'https://music.example',externalAudioURL:u=>u.hostname==='cdn.example',createObjectURL:()=> 'blob:verified-cache',revokeObjectURL:()=>{},...options})
 const audio=new Audio();cache.bindAudio(audio as unknown as HTMLAudioElement)
 async function select(id='netease:1'){const r=await cache.api.resolve(id);audio.src=r.url!;audio.end=0;return r}
 return {cache,audio,base,store,rows,fetcher,select,setOwner:(v:string)=>owner=v,remote}
}
const settled=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
describe('native first-play streaming before complete-file caching',()=>{
 it('returns the external URL without requesting full audio or waiting for track details',async()=>{
  const h=setup(),pending=deferred<Track[]>();vi.mocked(h.base.details).mockReturnValue(pending.promise)
  const result=h.cache.api.resolve('netease:1');let received:Resolution|undefined;void result.then(r=>received=r);await settled()
  expect(received?.url).toBe(h.remote('netease:1').url);expect(h.fetcher).not.toHaveBeenCalled();expect(h.base.details).not.toHaveBeenCalled();h.cache.dispose()
 })
 it('cannot wait on a complete-file cache lock held by an older open tab',async()=>{
  const h=setup({lock:async<T>(name:string,action:()=>Promise<T>)=>{if(name.startsWith('betago-device-audio:'))return new Promise<T>(()=>{});return action()}})
  let r:Resolution|undefined;void h.cache.api.resolve('netease:1').then(v=>r=v);await settled();expect(r?.url).toBe(h.remote('netease:1').url);expect(h.fetcher).not.toHaveBeenCalled();h.cache.dispose()
 })
 it('waits for actual playback and the whole native buffer, then saves without replacing active audio',async()=>{
  const h=setup();const r=await h.select();h.audio.end=h.audio.duration/2;h.audio.playing();h.audio.dispatchEvent(new Event('canplaythrough'));await settled();expect(h.fetcher).not.toHaveBeenCalled()
  h.audio.currentTime=1;h.audio.full();await vi.waitFor(()=>expect(h.rows.size).toBe(1));expect(h.audio.src).toBe(r.url);expect(h.audio.currentTime).toBe(1);expect(h.audio.paused).toBe(false)
  expect(h.fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'force-cache',mode:'cors',redirect:'error'})
  expect((await h.cache.api.resolve('netease:1')).url).toMatch(/^blob:/);expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it('never downloads just because a track resolved or was fully buffered while paused',async()=>{
  const h=setup();await h.select();h.audio.full();await settled();expect(h.fetcher).not.toHaveBeenCalled();h.audio.playing();await vi.waitFor(()=>expect(h.rows.size).toBe(1));h.cache.dispose()
 })
 it('single-flights repeated progress events and leaves the stream usable before background EOF',async()=>{
  const h=setup(),tail=deferred<Response>();h.fetcher.mockReturnValue(tail.promise);const r=await h.select();h.audio.playing();h.audio.full();h.audio.full();await vi.waitFor(()=>expect(h.fetcher).toHaveBeenCalledTimes(1))
  expect(h.rows.size).toBe(0);expect(h.audio.src).toBe(r.url);expect(h.cache.snapshot().state).toBe('downloading');tail.resolve(new Response(bytes()));await vi.waitFor(()=>expect(h.rows.size).toBe(1));h.cache.dispose()
 })
 it.each(['cors','quota','partial','short','invalid'])('keeps native playback and truthful state when caching fails: %s',async reason=>{
  const h=setup();if(reason==='cors')h.fetcher.mockRejectedValue(new TypeError('CORS'));if(reason==='quota')h.store.save=async()=>{throw Error('quota')};if(reason==='partial')h.fetcher.mockResolvedValue(new Response(bytes(),{status:206}));if(reason==='short')vi.mocked(h.base.details).mockResolvedValue([{id:'netease:1',source:'netease',externalID:'1',durationMs:180000} as Track]);if(reason==='invalid')h.fetcher.mockResolvedValue(new Response(new Uint8Array([1,2,3])))
  const r=await h.select();h.audio.playing();h.audio.full();await vi.waitFor(()=>expect(h.cache.snapshot().state).toBe('bypassed'));expect(h.rows.size).toBe(0);expect(h.audio.src).toBe(r.url);expect(h.audio.paused).toBe(false);expect(h.cache.snapshot().message).toMatch(/未保存|未缓存|不保存/);h.audio.full();await settled();expect(h.fetcher).toHaveBeenCalledTimes(1);h.cache.dispose()
 })
 it.each(['disable','clear','identity','switch','dispose'])('discards a late background result after %s without disturbing the stream',async mode=>{
  const h=setup(),pending=deferred<Response>();let signal:AbortSignal|undefined;h.fetcher.mockImplementationOnce(async(_url,init)=>{signal=init?.signal as AbortSignal;return pending.promise})
  const r=await h.select();h.audio.playing();h.audio.full();await vi.waitFor(()=>expect(h.fetcher).toHaveBeenCalledTimes(1))
  if(mode==='disable')await h.cache.setEnabled(false);if(mode==='clear')await h.cache.clear();if(mode==='identity'){h.setOwner('stream-B');await h.cache.api.recover('test-only')};if(mode==='switch')await h.select('netease:2');if(mode==='dispose')h.cache.dispose()
  expect(signal?.aborted).toBe(true);pending.resolve(new Response(bytes()));await settled();expect(h.rows.size).toBe(0);expect(h.cache.snapshot().state).not.toBe('cached');if(mode==='disable'||mode==='clear')expect(h.audio.src).toBe(r.url);h.cache.dispose()
 })
 it.each(['disable','identity','switch','dispose'])('removes a late completed save after %s',async mode=>{
  const h=setup(),started=deferred<void>(),finish=deferred<void>();h.store.save=async row=>{started.resolve();await finish.promise;h.rows.set(row.key,row)};await h.select();h.audio.playing();h.audio.full();await started.promise
  if(mode==='disable')await h.cache.setEnabled(false);if(mode==='identity'){h.setOwner('stream-B');await h.cache.api.recover('test-only')};if(mode==='switch')await h.select('netease:2');if(mode==='dispose')h.cache.dispose();finish.resolve();await settled();expect(h.rows.size).toBe(0);h.cache.dispose()
 })
 it('requires a new playing event after reloading the same URL',async()=>{
  const h=setup();await h.select();h.audio.playing();h.audio.dispatchEvent(new Event('loadstart'));h.audio.full();await settled();expect(h.fetcher).not.toHaveBeenCalled();h.audio.playing();await vi.waitFor(()=>expect(h.rows.size).toBe(1));h.cache.dispose()
 })
 it('removing the current audio source cancels late metadata before any fill request',async()=>{
  const h=setup(),details=deferred<Track[]>();vi.mocked(h.base.details).mockReturnValue(details.promise);await h.select();h.audio.playing();h.audio.full();await vi.waitFor(()=>expect(h.base.details).toHaveBeenCalledTimes(1));h.audio.removeAttribute();h.audio.dispatchEvent(new Event('emptied'));await settled();details.resolve([{id:'netease:1',source:'netease',externalID:'1',durationMs} as Track]);await settled();expect(h.fetcher).not.toHaveBeenCalled();expect(h.rows.size).toBe(0);h.cache.dispose()
 })
 it('stops old metadata before it can start a fetch or save after identity changes',async()=>{
  const h=setup(),details=deferred<Track[]>();vi.mocked(h.base.details).mockReturnValue(details.promise);await h.select();h.audio.playing();h.audio.full();await vi.waitFor(()=>expect(h.base.details).toHaveBeenCalledTimes(1));h.setOwner('stream-B');await h.cache.api.recover('test-only');details.resolve([{id:'netease:1',source:'netease',externalID:'1',durationMs} as Track]);await settled();expect(h.fetcher).not.toHaveBeenCalled();expect(h.rows.size).toBe(0);h.cache.dispose()
 })
})
