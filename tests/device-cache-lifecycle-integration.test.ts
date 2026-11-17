import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDeviceAudioCache } from '../src/core/device-audio-cache'
import type { DeviceAudioCache } from '../src/core/device-audio-cache'
import type { DeviceAudioRecord, DeviceAudioStore } from '../src/core/device-audio-cache-store'
import type { MusicApi, Track } from '../src/core/types'
const fixture=vi.hoisted(()=>({cache:undefined as DeviceAudioCache|undefined}))
vi.mock('../src/core/api',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/core/api')>()
 const musicApi=new Proxy({} as MusicApi,{get:(_target,key)=>Reflect.get(fixture.cache!.api,key)})
 const deviceAudioCache=new Proxy({} as DeviceAudioCache,{get:(_target,key)=>Reflect.get(fixture.cache!,key)})
 return {...actual,musicApi,deviceAudioCache}
})
import { useMusic } from '../src/stores/music'
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
const bytes=()=>{const b=new Uint8Array(417*200);for(let i=0;i<b.length;i+=417)b.set([0xff,0xfb,0x90,0],i);return b}
const durationMs=Math.floor(200*1152*1000/44100)
const track:Track={id:'netease:77',source:'netease',externalID:'77',title:'Actual store lifecycle regression',artist:'QA',album:'',picture:'',durationMs}
class NativeAudio extends EventTarget {
 src='';currentTime=0;duration=durationMs/1000;paused=true;volume=1;preload='';error=null
 get currentSrc(){return this.src}get buffered(){return {length:1,start:()=>0,end:()=>this.duration}}
 load(){if(this.src){this.dispatchEvent(new Event('loadstart'));queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')))}else this.dispatchEvent(new Event('emptied'))}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
 async play(){this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'))}
 removeAttribute(){this.src=''}
}
function setup(stage:'details'|'fetch'|'save'){
 const rows=new Map<string,DeviceAudioRecord>(),pending=deferred<void>(),started=deferred<void>();let signal:AbortSignal|undefined
 const store:DeviceAudioStore={get:async k=>rows.get(k),list:async()=>[...rows.values()].map(({blob:_,source:__,digest:___,...r})=>r),save:vi.fn(async row=>{if(stage==='save'){started.resolve();await pending.promise}rows.set(row.key,row)}),touch:async()=>{},remove:async k=>{rows.delete(k)},clear:async()=>rows.clear(),enabled:async()=>true,setEnabled:async()=>{}}
 const base={me:async()=>({user:{id:'test-store-owner',kind:'guest'},expiresAt:'2099-01-01T00:00:00Z'}),queue:async()=>({revision:0,trackIDs:[],currentIndex:0,positionMs:0}),saveQueue:async(_d:string,q:unknown)=>q,resolve:async(id:string)=>({trackID:id,status:'available',url:'https://cdn.example/store-lifecycle.mp3',expiresAt:'2099-01-01T00:00:00Z'}),details:vi.fn(async()=>{if(stage==='details'){started.resolve();await pending.promise}return [track]}),lyrics:async()=>({trackID:track.id,lrc:'',translatedLrc:''}),recordHistory:async()=>{}} as unknown as MusicApi
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{signal=init?.signal as AbortSignal;if(stage==='fetch'){started.resolve();await pending.promise}return new Response(bytes(),{headers:{'Content-Type':'audio/mpeg'}})})
 const cache=createDeviceAudioCache(base,{store,fetcher:fetcher as typeof fetch,origin:'https://music.example',externalAudioURL:u=>u.hostname==='cdn.example',createObjectURL:()=> 'blob:store-test',revokeObjectURL:()=>{}});fixture.cache=cache
 const music=useMusic();return {music,cache,rows,base,fetcher,store,pending,started,signal:()=>signal}
}
beforeEach(()=>{setActivePinia(createPinia());vi.stubGlobal('Audio',NativeAudio)})
afterEach(()=>{fixture.cache?.dispose();fixture.cache=undefined;vi.unstubAllGlobals()})
describe('real Pinia music store and NativePlayer teardown cancel device-cache fill',()=>{
 for(const entry of ['player.dispose','store.$dispose'] as const)for(const stage of ['details','fetch','save'] as const){
  it(`${entry} invalidates pending ${stage}, even though unbind precedes native src removal`,async()=>{
   const h=setup(stage);try{await h.music.player.initialize();await h.music.player.playTracks([track]);await vi.waitFor(()=>expect(stage==='details'?vi.mocked(h.base.details).mock.calls.length:stage==='fetch'?h.fetcher.mock.calls.length:vi.mocked(h.store.save).mock.calls.length).toBe(1),{timeout:800})
   expect(h.music.player.audio.paused).toBe(false)
   if(entry==='player.dispose')h.music.player.dispose();else h.music.$dispose()
   // Check synchronous cancellation, not eventual pagehide/cache.dispose cleanup.
   const signal=h.signal();if(signal)expect(signal.aborted).toBe(true)
   expect(h.cache.snapshot().state).not.toBe('downloading')
   h.pending.resolve();for(let i=0;i<50;i++)await Promise.resolve()
   expect(h.rows.size).toBe(0);if(stage==='details')expect(h.fetcher).not.toHaveBeenCalled()
   expect(h.music.player.audio.paused).toBe(true);expect(h.music.player.audio.src).toBe('')
   h.music.player.dispose();h.music.$dispose()
   }finally{h.pending.resolve()}
  })
 }
})
