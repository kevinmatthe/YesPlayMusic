import { describe, expect, it, vi } from 'vitest'
import * as apiModule from '../src/core/api'
import type { DeviceAudioCache, DeviceCacheOptions } from '../src/core/device-audio-cache'
import type { DeviceAudioRecord, DeviceAudioStore } from '../src/core/device-audio-cache-store'
import type { Resolution, Track } from '../src/core/types'

type Factory=(fetcher:typeof fetch,options?:DeviceCacheOptions)=>DeviceAudioCache
function factory():Factory {
 const make=(apiModule as unknown as {createDeviceCachedMusicApi?:Factory}).createDeviceCachedMusicApi
 expect(make,'live cache factory must wrap the unchanged raw direct API').toBeTypeOf('function')
 return make!
}
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0))
class PlaybackAudio extends EventTarget {
 src='';currentTime=0;duration:number;paused=true;readyState=4;bufferedEnd=0;playedEnd=0
 constructor(durationMs:number){super();this.duration=durationMs/1000}
 get currentSrc(){return this.src}
 get buffered(){const end=this.bufferedEnd;return {length:end>0?1:0,start:()=>0,end:()=>end} as TimeRanges}
 get played(){const end=this.playedEnd;return {length:end>0?1:0,start:()=>0,end:()=>end} as TimeRanges}
 prepare(url:string){this.src=url;this.currentTime=0;this.paused=true;this.bufferedEnd=0;this.playedEnd=0;this.dispatchEvent(new Event('loadstart'))}
 playIntent(){this.paused=false;this.bufferedEnd=this.duration;this.dispatchEvent(new Event('play'))}
 playing(){this.paused=false;this.currentTime=.25;this.playedEnd=.25;this.bufferedEnd=this.duration/2;this.dispatchEvent(new Event('playing'))}
 completeBuffer(){this.bufferedEnd=this.duration;this.dispatchEvent(new Event('progress'))}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
 load(){}
 getAttribute(name:string){return name==='src'?this.src||null:null}
 removeAttribute(name:string){if(name==='src')this.src=''}
}
function fixture(){
 const rows=new Map<string,DeviceAudioRecord>(),settings=new Map<string,boolean>()
 const store:DeviceAudioStore={get:async key=>rows.get(key),list:async()=>[...rows.values()].map(({blob:_,source:__,digest:___,...rest})=>rest),save:async row=>{rows.set(row.key,row)},touch:async(key,time)=>{const row=rows.get(key);if(row)row.lastUsedAt=time},remove:async key=>{rows.delete(key)},clear:async namespace=>{for(const[key,row]of rows)if(row.namespace===namespace)rows.delete(key)},enabled:async namespace=>settings.get(namespace)??true,setEnabled:async(namespace,value)=>{settings.set(namespace,value)}}
 const bytes=new Uint8Array(417*200);for(let pos=0;pos<bytes.length;pos+=417)bytes.set([0xff,0xfb,0x90,0],pos)
 const durationMs=Math.floor(200*1152*1000/44100);let userID='integration-guest-A',urlCount=0,reply:Partial<Resolution>={}
 const track=(id:string):Track=>({id,source:id.split(':')[0],externalID:id.split(':')[1],title:'Unit test metadata',artist:'QA',album:'',picture:'',durationMs})
 const fetcher=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
  const path=String(input)
  if(path.startsWith('https://'))return new Response(bytes,{headers:{'Content-Type':'audio/mpeg'}})
  if(path.endsWith('/me')||path.endsWith('/auth/guest'))return Response.json({user:{id:userID,kind:'guest'},expiresAt:'2099-01-01T00:00:00Z'})
  if(path.endsWith('/tracks/details'))return Response.json({tracks:(JSON.parse(String(options?.body)).ids as string[]).map(track)})
  if(path.endsWith('/resolve')){
   const id=decodeURIComponent(path.split('/tracks/')[1].split('/resolve')[0])
   return Response.json({trackID:id,status:'available',delivery:'direct',url:id.startsWith('kuwo:')?'https://kw-lv.kuwo.cn/qa.mp3':'https://m801.music.126.net/qa.mp3',expiresAt:new Date(Date.now()+300000).toISOString(),mediaSource:id.startsWith('kuwo:')?'kuwo:anonymous':'unm:pyncmd',originTrackID:id,matchMethod:'provider_external_id',verification:'audio_prefix',reason:'external_source',...reply})
  }
  throw new Error('Unexpected test API path '+path)
 })
 const options:DeviceCacheOptions={store,origin:'https://music.kmhomelab.cn:2443',createObjectURL:()=> 'blob:integration-'+(++urlCount),revokeObjectURL:()=>{}}
 return {rows,store,fetcher,options,durationMs,setReply:(value:Partial<Resolution>)=>reply=value,setOwner:(value:string)=>userID=value,requests:(fragment:string)=>fetcher.mock.calls.filter(call=>String(call[0]).includes(fragment))}
}

describe('integrated device cache with the real direct API adapter',()=>{
 it('installs the decorator on the actual exported live singleton',()=>{
  const live=(apiModule as unknown as {deviceAudioCache?:DeviceAudioCache}).deviceAudioCache
  expect(live,'the shipped singleton must use the cache').toBeDefined();expect(apiModule.musicApi).toBe(live!.api)
 })
 it.each(['netease:1483378295','kuwo:629335603'])('streams %s immediately and caches only after actual playback and full buffering for a later replay',async id=>{
  const h=fixture(),cache=factory()(h.fetcher as typeof fetch,h.options),audio=new PlaybackAudio(h.durationMs);cache.bindAudio(audio as unknown as HTMLAudioElement)
  const first=await cache.api.resolve(id)
  expect(first.url).toBe(id.startsWith('kuwo:')?'https://kw-lv.kuwo.cn/qa.mp3':'https://m801.music.126.net/qa.mp3');expect(first.status).toBe('available');expect(first.reason).toBe('external_source');expect(first.originTrackID).toBe(id)
  expect(h.requests('/resolve')).toHaveLength(1);expect(h.requests('/tracks/details')).toHaveLength(0);expect(h.requests('https://')).toHaveLength(0);expect(h.rows.size).toBe(0)
  expect(h.requests('/resolve')[0][1]).toMatchObject({body:JSON.stringify({delivery:'direct'}),headers:{'X-Music-Delivery':'direct'}})
  audio.prepare(first.url!);audio.playIntent();await settle();expect(h.requests('https://')).toHaveLength(0)
  audio.playing();await settle();expect(h.requests('https://')).toHaveLength(0);expect(h.rows.size).toBe(0)
  audio.completeBuffer();await vi.waitFor(()=>expect(h.rows.size).toBe(1))
  expect(h.requests('https://')).toHaveLength(1);expect(h.requests('https://')[0][1]).toMatchObject({credentials:'omit',mode:'cors',cache:'force-cache',redirect:'error'})
  expect(audio.src).toBe(first.url);expect(audio.currentTime).toBe(.25);expect(audio.paused).toBe(false);expect(first.status).toBe('available')
  h.fetcher.mockClear();expect((await cache.api.resolve(id)).url).toMatch(/^blob:/);const reopened=factory()(h.fetcher as typeof fetch,h.options);expect((await reopened.api.resolve(id)).url).toMatch(/^blob:/)
  expect(h.requests('/resolve')).toHaveLength(0);expect(h.requests('https://')).toHaveLength(0)
  expect(JSON.stringify([...h.rows.values()])).not.toMatch(/https:|expiresAt|cookie|integration-guest-A/i)
  cache.dispose();reopened.dispose()
 })
 it('runs every cache miss through raw status, delivery and source-specific host checks',async()=>{
  for(const reply of [{delivery:undefined},{status:'available',url:'https://music.kmhomelab.cn:2443/cloudmusic/audio.mp3'},{url:'https://kw-lv.kuwo.cn/wrong-source.mp3'},{status:'unknown'}] as Partial<Resolution>[]){
   const h=fixture();h.setReply(reply);const cache=factory()(h.fetcher as typeof fetch,h.options),audio=new PlaybackAudio(h.durationMs);cache.bindAudio(audio as unknown as HTMLAudioElement);const result=await cache.api.resolve('netease:1483378295')
   audio.prepare(result.url??'');audio.playing();audio.completeBuffer();await settle()
   expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.requests('https://')).toHaveLength(0);expect(h.rows.size).toBe(0);cache.dispose()
  }
 })
 it('keeps an explicit preview and a CORS-denied source playable directly without marking either persisted',async()=>{
  const preview=fixture();preview.setReply({status:'preview'});const a=factory()(preview.fetcher as typeof fetch,preview.options)
  const previewAudio=new PlaybackAudio(preview.durationMs);a.bindAudio(previewAudio as unknown as HTMLAudioElement)
  const short=await a.api.resolve('netease:1483378295');expect(short).toMatchObject({status:'preview',url:'https://m801.music.126.net/qa.mp3',reason:'external_source'});previewAudio.prepare(short.url!);previewAudio.playing();previewAudio.completeBuffer();await settle();expect(preview.requests('/tracks/details')).toHaveLength(0);expect(preview.requests('https://')).toHaveLength(0);expect(preview.rows.size).toBe(0);expect(short.status).toBe('preview')
  const denied=fixture(),real=denied.fetcher.getMockImplementation()!;denied.fetcher.mockImplementation(async(input,options)=>{if(String(input).startsWith('https://'))throw new TypeError('CORS denied');return real(input,options)})
  const b=factory()(denied.fetcher as typeof fetch,denied.options),audio=new PlaybackAudio(denied.durationMs);b.bindAudio(audio as unknown as HTMLAudioElement)
  const result=await b.api.resolve('netease:1483378295');expect(result.url).toBe('https://m801.music.126.net/qa.mp3');expect(denied.requests('https://')).toHaveLength(0)
  audio.prepare(result.url!);audio.playing();audio.completeBuffer();await vi.waitFor(()=>expect(denied.requests('https://')).toHaveLength(1));await vi.waitFor(()=>expect(b.snapshot().state).toBe('bypassed'))
  expect(result.status).toBe('available');expect(result.reason).not.toContain('device_audio_cache');expect(audio.src).toBe(result.url);expect(audio.paused).toBe(false);expect(audio.currentTime).toBe(.25);expect(denied.rows.size).toBe(0);a.dispose();b.dispose()
 })
 it('binds restored cookies to their actual server user before reading a previously warmed cache',async()=>{
  const h=fixture(),cache=factory()(h.fetcher as typeof fetch,h.options),audio=new PlaybackAudio(h.durationMs);cache.bindAudio(audio as unknown as HTMLAudioElement);await cache.api.ensureGuest()
  const first=await cache.api.resolve('netease:1483378295');expect(first.url).toBe('https://m801.music.126.net/qa.mp3');expect(h.requests('https://')).toHaveLength(0);audio.prepare(first.url!);audio.playing();audio.completeBuffer();await vi.waitFor(()=>expect(h.rows.size).toBe(1))
  h.setOwner('integration-guest-B');await cache.api.ensureGuest();const second=await cache.api.resolve('netease:1483378295');expect(second.url).toBe('https://m801.music.126.net/qa.mp3');expect(h.rows.size).toBe(1);expect(h.requests('https://')).toHaveLength(1)
  audio.prepare(second.url!);audio.playing();audio.completeBuffer();await vi.waitFor(()=>expect(h.rows.size).toBe(2))
  expect(h.rows.size).toBe(2);expect(new Set([...h.rows.values()].map(row=>row.namespace)).size).toBe(2);expect(h.requests('/resolve')).toHaveLength(2);cache.dispose()
 })
})
