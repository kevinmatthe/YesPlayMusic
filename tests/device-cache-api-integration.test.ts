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
 return {rows,store,fetcher,options,setReply:(value:Partial<Resolution>)=>reply=value,setOwner:(value:string)=>userID=value,requests:(fragment:string)=>fetcher.mock.calls.filter(call=>String(call[0]).includes(fragment))}
}

describe('integrated device cache with the real direct API adapter',()=>{
 it('installs the decorator on the actual exported live singleton',()=>{
  const live=(apiModule as unknown as {deviceAudioCache?:DeviceAudioCache}).deviceAudioCache
  expect(live,'the shipped singleton must use the cache').toBeDefined();expect(apiModule.musicApi).toBe(live!.api)
 })
 it.each(['netease:1483378295','kuwo:629335603'])('fills %s with one external GET and replays/reopens with zero resolve or media requests',async id=>{
  const h=fixture(),cache=factory()(h.fetcher as typeof fetch,h.options);const first=await cache.api.resolve(id)
  expect(first.url).toMatch(/^blob:/);expect(first.reason).toContain('device_audio_cache');expect(first.originTrackID).toBe(id)
  expect(h.requests('/resolve')).toHaveLength(1);expect(h.requests('https://')).toHaveLength(1)
  expect(h.requests('/resolve')[0][1]).toMatchObject({body:JSON.stringify({delivery:'direct'}),headers:{'X-Music-Delivery':'direct'}})
  expect(h.requests('https://')[0][1]).toMatchObject({credentials:'omit',mode:'cors',cache:'no-store',redirect:'error'})
  h.fetcher.mockClear();await cache.api.resolve(id);const reopened=factory()(h.fetcher as typeof fetch,h.options);expect((await reopened.api.resolve(id)).url).toMatch(/^blob:/)
  expect(h.requests('/resolve')).toHaveLength(0);expect(h.requests('https://')).toHaveLength(0)
  expect(JSON.stringify([...h.rows.values()])).not.toMatch(/https:|expiresAt|cookie|integration-guest-A/i)
  cache.dispose();reopened.dispose()
 })
 it('runs every cache miss through raw status, delivery and source-specific host checks',async()=>{
  for(const reply of [{delivery:undefined},{status:'available',url:'https://music.kmhomelab.cn:2443/cloudmusic/audio.mp3'},{url:'https://kw-lv.kuwo.cn/wrong-source.mp3'},{status:'unknown'}] as Partial<Resolution>[]){
   const h=fixture();h.setReply(reply);const cache=factory()(h.fetcher as typeof fetch,h.options),result=await cache.api.resolve('netease:1483378295')
   expect(result.status).toBe('unavailable');expect(result.url).toBeUndefined();expect(h.requests('https://')).toHaveLength(0);expect(h.rows.size).toBe(0);cache.dispose()
  }
 })
 it('keeps an explicit preview and a CORS-denied source playable directly without marking either persisted',async()=>{
  const preview=fixture();preview.setReply({status:'preview'});const a=factory()(preview.fetcher as typeof fetch,preview.options)
  expect(await a.api.resolve('netease:1483378295')).toMatchObject({status:'preview',url:'https://m801.music.126.net/qa.mp3',reason:'external_source'});expect(preview.requests('https://')).toHaveLength(0);expect(preview.rows.size).toBe(0)
  const denied=fixture(),real=denied.fetcher.getMockImplementation()!;denied.fetcher.mockImplementation(async(input,options)=>{if(String(input).startsWith('https://'))throw new TypeError('CORS denied');return real(input,options)})
  const b=factory()(denied.fetcher as typeof fetch,denied.options),result=await b.api.resolve('netease:1483378295');expect(result.url).toBe('https://m801.music.126.net/qa.mp3');expect(result.reason).not.toContain('device_audio_cache');expect(denied.rows.size).toBe(0);a.dispose();b.dispose()
 })
 it('binds restored cookies to their actual server user before reading a previously warmed cache',async()=>{
  const h=fixture(),cache=factory()(h.fetcher as typeof fetch,h.options);await cache.api.ensureGuest();await cache.api.resolve('netease:1483378295');h.setOwner('integration-guest-B');await cache.api.ensureGuest();await cache.api.resolve('netease:1483378295')
  expect(h.rows.size).toBe(2);expect(new Set([...h.rows.values()].map(row=>row.namespace)).size).toBe(2);expect(h.requests('/resolve')).toHaveLength(2);cache.dispose()
 })
})
