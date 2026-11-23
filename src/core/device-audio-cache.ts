import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { MusicApi, Resolution, Session } from './types'
import { createIndexedDBAudioStore } from './device-audio-cache-store'
import type { DeviceAudioRecord, DeviceAudioStore } from './device-audio-cache-store'
import { completeMP3DurationMs, validateCompleteMP3 } from './device-audio-cache-mp3'
import { hasVerifiedKuwoMatch } from './audio-source'

export const DEVICE_CACHE_BYTES=256*1024*1024
export const DEVICE_TRACK_BYTES=64*1024*1024
// Document-local object URL lifetime, never an extension of provider permissions.
// Every URL is revoked on release/account changes; no URL is persisted.
const LOCAL_LEASE_END='9999-12-31T23:59:59.999Z'
const stableID=/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._-]{1,180}$/
type CacheState='idle'|'streaming'|'downloading'|'cached'|'memory'|'bypassed'|'disabled'
export interface DeviceCacheSnapshot {
 enabled:boolean;usedBytes:number;count:number;limitBytes:number;state:CacheState;message:string;persistent:boolean
}
export interface DeviceCacheOptions {
 store?:DeviceAudioStore;fetcher?:typeof fetch;now?:()=>number;origin?:string;maxBytes?:number;maxTrackBytes?:number
 createObjectURL?:(blob:Blob)=>string;revokeObjectURL?:(url:string)=>void
 lock?:<T>(name:string,action:()=>Promise<T>)=>Promise<T>
 // Supplied by the direct-source integrator's trusted provider-host contract.
 // With no policy, fill is disabled; existing account-scoped bytes remain usable.
 externalAudioURL?:(url:URL,trackID:string,source:Resolution)=>boolean
 blockedAudioHosts?:readonly string[]
 resolveRemote?:(id:string)=>Promise<Resolution>
}
interface Context {namespace:string;generation:number;selection:number;id:string;key:string}
interface PendingFill {ctx:Context;res:Resolution;started:boolean}
interface Lease {url:string;key:string;namespace:string}
interface IdentityBinding {owner:string;namespace:string;revision:number}
const aborted=()=>new DOMException('缓存准备已取消，可重试当前歌曲。','AbortError')
const digest=(bytes:Uint8Array)=>bytesToHex(sha256(bytes))
const capacity=(value:number|undefined,fallback:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:fallback
function staticSource(res:Resolution):DeviceAudioRecord['source'] {
 const source:DeviceAudioRecord['source']={}
 if(/^[a-z][a-z0-9_-]{0,31}:[a-z][a-z0-9_-]{0,31}$/.test(res.mediaSource||''))source.mediaSource=res.mediaSource
 const matched=hasVerifiedKuwoMatch(res.trackID,res)
 if(res.originTrackID===res.trackID||matched)source.originTrackID=res.originTrackID
 if(res.matchMethod==='provider_external_id'||matched)source.matchMethod=res.matchMethod
 if(['audio_prefix','id_and_duration','provider_id'].includes(res.verification||''))source.verification=res.verification
 if(/^[a-z0-9_]{1,120}$/.test(res.reason||''))source.reason=res.reason
 return source
}
export function createDeviceAudioCache(base:MusicApi,options:DeviceCacheOptions={}) {
 const store=options.store??createIndexedDBAudioStore(),fetcher=options.fetcher??globalThis.fetch.bind(globalThis)
 const now=options.now??Date.now,origin=options.origin??(typeof location==='undefined'?'':location.origin)
 function externalURL(value:string):URL|undefined {
  try{
   const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,'')
   if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||host==='localhost'||host.endsWith('.local')||host.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(host))return
   const blocked=[...(options.blockedAudioHosts??[]),...(origin?[new URL(origin).hostname]:[])]
   if(blocked.some(value=>{const denied=value.toLowerCase().replace(/^\./,'').replace(/\.$/,'');return host===denied||host.endsWith('.'+denied)}))return
   return url
  }catch{return}
 }
 function approvedURL(value:string,res:Resolution){
  const url=externalURL(value);try{return !!url&&!!options.externalAudioURL?.(url,res.trackID,res)}catch{return false}
 }
 const blockedResolution=(res:Resolution):Resolution=>({...res,status:'unavailable',url:undefined,expiresAt:undefined,reason:'当前音源不是允许的外部直连地址，已停止播放。'})
 const maxBytes=capacity(options.maxBytes,DEVICE_CACHE_BYTES),maxTrackBytes=capacity(options.maxTrackBytes,DEVICE_TRACK_BYTES)
 const createURL=options.createObjectURL??((blob:Blob)=>URL.createObjectURL(blob)),revokeURL=options.revokeObjectURL??((url:string)=>URL.revokeObjectURL(url))
 const listeners=new Set<(state:DeviceCacheSnapshot)=>void>(),leases=new Map<string,Lease>(),audios=new Set<HTMLAudioElement>(),unbinds=new Set<()=>void>()
 const streams=new Set<string>(),saves=new Set<Promise<void>>(),playedSources=new WeakMap<HTMLAudioElement,string>()
 let pendingFill:PendingFill|undefined
 const flights=new Map<string,Promise<Resolution>>(),controllers=new Map<string,AbortController>(),badKeys=new Set<string>(),invalidations=new Map<string,Promise<void>>()
 let owner='',namespace='',generation=0,identityRevision=0,selection=0,selected='',disposed=false,storageAvailable=true,newestURL=''
 let ownerReady:Promise<void>=Promise.resolve(),mePending:Promise<Session>|undefined
 let state:DeviceCacheSnapshot={enabled:true,usedBytes:0,count:0,limitBytes:maxBytes,state:'idle',message:'',persistent:false}
 const sessionNamespace=(session:Session)=>'v1-'+digest(new TextEncoder().encode(origin+'\n'+session.user.id))
 function checkSession(session:Session){if(disposed||owner!==session.user.id||namespace!==sessionNamespace(session))throw aborted()}
 function checkBinding(binding:IdentityBinding,session:Session){
  checkSession(session)
  if(binding.revision!==identityRevision||binding.owner!==owner||binding.namespace!==namespace)throw aborted()
 }
 const snapshot=()=>({...state})
 function publish(patch:Partial<DeviceCacheSnapshot>){state={...state,...patch};listeners.forEach(listener=>listener(snapshot()))}
 function cancelDownloads(){pendingFill=undefined;controllers.forEach(controller=>controller.abort());controllers.clear();flights.clear()}
 function releaseURLs(){
  for(const audio of audios)if(leases.has(audio.src)||leases.has(audio.currentSrc)||streams.has(audio.src)||streams.has(audio.currentSrc)){audio.pause();audio.removeAttribute('src');audio.load()}
  leases.forEach(lease=>revokeURL(lease.url));leases.clear();streams.clear();newestURL=''
 }
 function reapURLs(){
  const used=new Set<string>();audios.forEach(audio=>{if(audio.src)used.add(audio.src);if(audio.currentSrc)used.add(audio.currentSrc)})
  for(const [url]of leases)if(url!==newestURL&&!used.has(url)){revokeURL(url);leases.delete(url)}
 }
 function invalidateOwner(){
  generation++;identityRevision++;mePending=undefined;cancelDownloads();releaseURLs();badKeys.clear();owner='';namespace='';ownerReady=Promise.resolve()
  publish({enabled:true,usedBytes:0,count:0,state:'idle',message:''})
 }
 async function usage(expected=namespace){
  try{const rows=await store.list();if(expected!==namespace||disposed)return;const own=rows.filter(row=>row.namespace===expected);publish({usedBytes:own.reduce((n,row)=>n+row.byteLength,0),count:own.length})}
  catch{if(expected===namespace)storageAvailable=false}
 }
 async function bindSession(session:Session){
  if(!session.user?.id)throw new Error('音乐会话缺少服务端账号标识。')
  if(owner!==session.user.id){
   // /me can observe a cookie changed by another tab without recover/exchange.
   // That implicit boundary invalidates old profile/session response tokens too.
   generation++;identityRevision++;cancelDownloads();releaseURLs();badKeys.clear();owner=session.user.id
   namespace=sessionNamespace(session);storageAvailable=true
   const bound=namespace;publish({enabled:true,usedBytes:0,count:0,state:'idle',message:''})
   ownerReady=(async()=>{try{const enabled=await store.enabled(bound);if(bound===namespace)publish({enabled});await usage(bound)}catch{if(bound===namespace){storageAvailable=false;publish({state:'bypassed',message:'浏览器存储不可用，本次未缓存，仍可直接播放。'})}}})()
  }
  const binding:IdentityBinding={owner,namespace,revision:identityRevision},ready=ownerReady
  await ready;checkBinding(binding,session);return binding
 }
 async function authenticated():Promise<Session>{
  if(disposed)throw aborted()
  if(!mePending){const revision=identityRevision
   const pending=(async()=>{try{const session=await base.me();if(revision!==identityRevision||disposed)throw aborted();const binding=await bindSession(session);checkBinding(binding,session);return session}catch(error){if(revision===identityRevision&&typeof error==='object'&&error!==null&&'status'in error&&error.status===401)invalidateOwner();throw error}})()
   mePending=pending;void pending.finally(()=>{if(mePending===pending)mePending=undefined}).catch(()=>{})
  }
  return mePending
 }
 const current=(ctx:Context)=>!disposed&&ctx.namespace===namespace&&ctx.generation===generation&&ctx.selection===selection&&ctx.id===selected
 const check=(ctx:Context)=>{if(!current(ctx))throw aborted()}
 async function lock<T>(name:string,action:()=>Promise<T>):Promise<T>{
  if(options.lock)return options.lock(name,action)
  if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(name,action)
  return action()
 }
 function localResolution(ctx:Context,blob:Blob,res:Resolution,persisted:boolean,preserveReason=false):Resolution {
  check(ctx);const url=createURL(blob);leases.set(url,{url,key:ctx.key,namespace:ctx.namespace});newestURL=url;reapURLs()
  return {...res,url,expiresAt:LOCAL_LEASE_END,...(preserveReason?{}:{reason:(persisted?'device_audio_cache':'device_audio_memory')+(res.reason?':'+res.reason:'')})}
 }
 async function fromCache(ctx:Context):Promise<Resolution|undefined>{
  if(!storageAvailable||badKeys.has(ctx.key))return
  let row:DeviceAudioRecord|undefined
  try{row=await store.get(ctx.key)}catch{storageAvailable=false;return}
  check(ctx);if(!row)return
  let valid=false
  try{
   if(row.namespace===ctx.namespace&&row.trackID===ctx.id&&row.key===ctx.key&&row.blob instanceof Blob&&row.byteLength===row.blob.size&&row.byteLength>0&&row.byteLength<=maxTrackBytes){
    const bytes=new Uint8Array(await row.blob.arrayBuffer());check(ctx)
    valid=/^[a-f0-9]{64}$/.test(row.digest)&&digest(bytes)===row.digest&&!!validateCompleteMP3(bytes,row.canonicalDurationMs)
   }
  }catch(error){if(!current(ctx))throw error}
  check(ctx)
  if(!valid){pendingFill=undefined;badKeys.add(ctx.key);await store.remove(ctx.key).catch(()=>{});return}
  await store.touch(ctx.key,now()).catch(()=>{});check(ctx)
  publish({state:'cached',message:'正在使用本机完整缓存，无需重新取源。'})
  return localResolution(ctx,row.blob,{trackID:ctx.id,status:'available',...staticSource({trackID:ctx.id,status:'available',...row.source})},true)
 }
 async function readFull(response:Response,controller:AbortController,ctx:Context):Promise<Uint8Array<ArrayBuffer>>{
  const declared=Number(response.headers.get('Content-Length')||0)
  if(declared>maxTrackBytes)throw new Error('too_large')
  if(!response.body)throw new Error('empty_body')
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0
  try{
   for(;;){check(ctx);if(controller.signal.aborted)throw aborted();const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>maxTrackBytes)throw new Error('too_large');chunks.push(new Uint8Array(part.value))}
   if(!length||(declared>0&&declared!==length))throw new Error('incomplete_body')
   const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.byteLength}return bytes
  }catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 }
 async function load(ctx:Context):Promise<Resolution>{
  check(ctx);await invalidations.get(ctx.key);check(ctx)
  const hit=await fromCache(ctx);if(hit){pendingFill=undefined;return hit}
  check(ctx)
  const res=await (options.resolveRemote?options.resolveRemote(ctx.id):base.resolve(ctx.id));check(ctx)
  if(res.trackID!==ctx.id)return res
  // This guard precedes preview/disabled/storage fallback. Old server delivery
  // must never become a playable proxy fallback in the direct-only client.
  if(res.url&&(res.reason?.startsWith('owned_minio_cache')||!externalURL(res.url))){publish({state:'bypassed',message:'服务器传输或非外部地址已拒绝，不会用作直连兜底。'});return blockedResolution(res)}
  if(res.url&&(res.status==='available'||res.status==='preview'))streams.add(res.url)
  if(res.status!=='available'||!res.url)return res
  if(!state.enabled||!storageAvailable){publish({state:state.enabled?'bypassed':'disabled',message:state.enabled?'浏览器存储不可用，本次未缓存，仍可直接播放。':'自动缓存已关闭；已有缓存仍可播放。'});return res}
  if(!approvedURL(res.url,res)){publish({state:'bypassed',message:'此外部音源尚未启用本机缓存，仍可原地址直放。'});return res}
  if(!Number.isFinite(Date.parse(res.expiresAt||''))||Date.parse(res.expiresAt!)<=now())return res
  // The native media element owns first playback. No details/full fetch/save
  // may delay this resolution, and background completion never swaps its src.
  if(!pendingFill||pendingFill.ctx.key!==ctx.key||pendingFill.ctx.generation!==ctx.generation||pendingFill.ctx.selection!==ctx.selection)pendingFill={ctx,res,started:false}
  publish({state:'streaming',message:'正在使用外部音源流式播放；完整缓冲后尝试保存本机缓存，开播无需等待整曲下载。'})
  return res
 }
 async function fill(candidate:PendingFill):Promise<void>{
  const {ctx,res}=candidate
  const checkFill=()=>{check(ctx);if(pendingFill!==candidate||!state.enabled)throw aborted()}
  try{
   // Separate lock from resolve: another tab saving bytes cannot block play.
   await lock('betago-device-audio-fill:'+ctx.key,async()=>{
    checkFill();if(!state.enabled||!storageAvailable)return
    const existing=await store.get(ctx.key);checkFill()
    if(existing&&!badKeys.has(ctx.key))return
    const details=await base.details([ctx.id]);checkFill()
    const track=details.find(track=>track.id===ctx.id)
    if(!track||track.id!==track.source+':'+track.externalID||!Number.isFinite(track.durationMs)||track.durationMs<=0)throw new Error('missing_duration')
    if(!state.enabled)return
    const canonicalMs=track.durationMs,controller=new AbortController();controllers.set(ctx.key,controller)
    const timeout=setTimeout(()=>controller.abort(),90000)
    publish({state:'downloading',message:'正在后台校验并保存本机缓存，当前流式播放不受影响。'})
    try{
     // HTML audio does not expose the bytes it buffered. Reuse HTTP cache when
     // possible; otherwise this can be one extra external GET, after buffering.
     const response=await fetcher(res.url!,{method:'GET',credentials:'omit',mode:'cors',cache:'force-cache',redirect:'error',signal:controller.signal});checkFill()
     if(response.url&&!approvedURL(response.url,res))throw new Error('non_external_response')
     if(response.status!==200||response.type==='opaque')throw new Error('incomplete_response')
     const bytes=await readFull(response,controller,ctx);checkFill()
     const full=validateCompleteMP3(bytes,canonicalMs)
     if(!full){
      const actual=completeMP3DurationMs(bytes),tolerance=Math.max(1500,Math.min(5000,Math.floor(canonicalMs*.03)))
      throw new Error(actual!==undefined&&canonicalMs-actual>tolerance?'short_media':'unverified_media')
     }
     const at=now(),row:DeviceAudioRecord={key:ctx.key,namespace:ctx.namespace,trackID:ctx.id,blob:new Blob([bytes],{type:'audio/mpeg'}),byteLength:bytes.length,digest:digest(bytes),canonicalDurationMs:canonicalMs,durationMs:full.durationMs,createdAt:at,lastUsedAt:at,source:staticSource(res)}
     checkFill();if(!state.enabled)return
     const saving=store.save(row,maxBytes);saves.add(saving)
     try{await saving}finally{saves.delete(saving)}
     if(!current(ctx)||pendingFill!==candidate||!state.enabled){
      // A transaction already started cannot be aborted through the store API.
      // Still under the per-key fill lock: discard only this just-written row.
      const saved=await store.get(ctx.key)
      if(saved?.createdAt===row.createdAt&&saved.digest===row.digest)await store.remove(ctx.key)
      return
     }
     checkFill();badKeys.delete(ctx.key);await usage(ctx.namespace);checkFill()
     publish({state:'cached',message:'完整音频已保存到本机，播放不受影响；重播可使用本机缓存。'})
    }finally{clearTimeout(timeout);controller.abort();if(controllers.get(ctx.key)===controller)controllers.delete(ctx.key)}
   })
  }catch(error){
   if(!current(ctx)||pendingFill!==candidate||!state.enabled)return
   const reason=error instanceof Error?error.message:''
   publish({state:'bypassed',message:reason==='too_large'?'音频超过单曲缓存上限，本次未缓存；流式播放不受影响。':reason==='short_media'?'音频短于曲库标注，按试听使用，不保存为完整缓存；流式播放不受影响。':reason==='missing_duration'?'缺少可核对的曲目时长，本次未缓存；流式播放不受影响。':'后台缓存未保存（读取、完整性检查或存储未成功）；流式播放不受影响。'})
  }
 }
 function maybeFill(audio:HTMLAudioElement){
  const candidate=pendingFill
  if(!candidate||candidate.started||!current(candidate.ctx)||!state.enabled||!storageAvailable||audio.paused)return
  const source=audio.currentSrc||audio.src
  if(source!==candidate.res.url||playedSources.get(audio)!==source)return
  // canplaythrough is only an estimate. Require an actual contiguous full
  // buffered range; paused preload, partial ranges and live streams never fill.
  const ranges=audio.buffered,duration=audio.duration
  if(!Number.isFinite(duration)||duration<=0||!ranges||ranges.length!==1||ranges.start(0)>.05||ranges.end(0)<duration-.05)return
  candidate.started=true
  void fill(candidate)
 }
 async function resolve(id:string):Promise<Resolution>{
  if(id!==selected){selection++;selected=id;cancelDownloads()}
  const intended=selection,session=await authenticated();checkSession(session);if(intended!==selection)throw aborted()
  if(!stableID.test(id))return base.resolve(id)
  const ctx:Context={namespace,generation,selection:intended,id,key:namespace+'/'+id}
  let flight=flights.get(ctx.key)
  if(!flight){flight=lock('betago-device-audio-resolve-v2:'+ctx.key,()=>load(ctx));flights.set(ctx.key,flight);const running=flight;void running.finally(()=>{if(flights.get(ctx.key)===running)flights.delete(ctx.key)}).catch(()=>{})}
  return flight
 }
 async function switchSession(action:()=>Promise<Session>):Promise<Session>{
  invalidateOwner()
  const revision=identityRevision
  try{const session=await action();if(revision!==identityRevision||disposed)throw aborted();const binding=await bindSession(session);checkBinding(binding,session);return session}
  catch(error){if(revision===identityRevision)try{await authenticated()}catch{}throw error}
 }
 const api:MusicApi={...base,resolve,me:authenticated,
  async ensureGuest(){await base.ensureGuest();return authenticated()},
  recover:code=>switchSession(()=>base.recover(code)),exchangeFeishu:code=>switchSession(()=>base.exchangeFeishu(code)),
  async refreshFeishuProfile(code){
   const revision=identityRevision,expectedOwner=owner
   const session=await base.refreshFeishuProfile(code)
   if(revision!==identityRevision||disposed)throw aborted()
   if(owner!==expectedOwner)throw aborted()
   if(expectedOwner&&session.user.id!==expectedOwner)throw new Error('资料更新返回了不同账号，请重新载入。')
   const binding=await bindSession(session);checkBinding(binding,session);return session
  },
  async logout(){invalidateOwner();await base.logout()},
 }
 async function refresh(){const session=await authenticated();checkSession(session);await usage()}
 async function setEnabled(value:boolean){
  const session=await authenticated();checkSession(session);const bound=namespace;await store.setEnabled(bound,value)
  if(bound!==namespace)return
  publish({enabled:value,...(!value?{state:'disabled',message:'自动缓存已关闭，已取消后台缓存；流式播放和已有缓存仍可使用。'}:{state:'idle',message:'自动缓存已开启；下次播放会在完整缓冲后尝试保存。'})})
  if(!value)cancelDownloads()
 }
 async function clear(){
  const session=await authenticated();checkSession(session);const bound=namespace,pending=!!pendingFill||controllers.size>0;generation++;cancelDownloads();await Promise.allSettled([...saves]);await store.clear(bound)
  if(bound===namespace){badKeys.clear();await usage(bound);publish({state:'idle',message:pending?'已取消后台缓存并清空当前空间缓存；歌单和喜欢不受影响。':'当前空间的本机音频缓存已清空；歌单和喜欢不受影响。'})}
 }
 async function requestPersistence(){
  try{const persistent=typeof navigator!=='undefined'&&!!navigator.storage?.persist&&await navigator.storage.persist();publish({persistent,message:persistent?'浏览器已允许持久存储；你仍可手动清除本机缓存。':'浏览器未批准持久存储，仍可正常使用，缓存可能被浏览器回收。'});return persistent}catch{publish({message:'浏览器未批准持久存储，仍可正常使用。'});return false}
 }
 function bindAudio(audio:HTMLAudioElement){
  audios.add(audio)
  const error=()=>{
   if(pendingFill?.res.url===(audio.currentSrc||audio.src))cancelDownloads()
   const lease=leases.get(audio.currentSrc||audio.src);if(!lease||lease.namespace!==namespace)return
   // Capture runs before NativePlayer's original non-capture recovery listener.
   // Poison the key synchronously, preserving its existing one-retry budget.
   pendingFill=undefined;badKeys.add(lease.key);const removing=store.remove(lease.key).catch(()=>{});invalidations.set(lease.key,removing)
   void removing.finally(()=>{if(invalidations.get(lease.key)===removing)invalidations.delete(lease.key)})
   publish({state:'bypassed',message:'本机音频无法读取，正在按原播放规则重新取源。'})
  }
  const playing=()=>{playedSources.set(audio,audio.currentSrc||audio.src);maybeFill(audio)}
  const progress=()=>maybeFill(audio)
  const changed=()=>{playedSources.delete(audio);queueMicrotask(()=>{if(pendingFill&&audio.src!==pendingFill.res.url)cancelDownloads();if(audio.src===newestURL||audio.currentSrc===newestURL)newestURL='';reapURLs()})}
  audio.addEventListener('playing',playing);for(const event of ['progress','canplaythrough','suspend'])audio.addEventListener(event,progress)
  audio.addEventListener('error',error,true);audio.addEventListener('loadstart',changed);audio.addEventListener('emptied',changed)
  let bound=true
  const unbind=()=>{
   if(!bound)return;bound=false
   audio.removeEventListener('playing',playing);for(const event of ['progress','canplaythrough','suspend'])audio.removeEventListener(event,progress);playedSources.delete(audio);audio.removeEventListener('error',error,true);audio.removeEventListener('loadstart',changed);audio.removeEventListener('emptied',changed);audios.delete(audio);unbinds.delete(unbind)
   // The real store unbinds before player.dispose removes src. Invalidate work
   // here; an emptied event will no longer be observed after the final unbind.
   if(!audios.size){generation++;selection++;selected='';cancelDownloads();publish({state:'idle',message:''})}
   reapURLs()
  }
  unbinds.add(unbind);return unbind
 }
 function dispose(){if(disposed)return;disposed=true;cancelDownloads();releaseURLs();[...unbinds].forEach(unbind=>unbind());listeners.clear();if(typeof window!=='undefined')window.removeEventListener('pagehide',hide)}
 const hide=(event:PageTransitionEvent)=>{if(!event.persisted)dispose()}
 if(typeof window!=='undefined')window.addEventListener('pagehide',hide)
 return {api,snapshot,subscribe:(listener:(state:DeviceCacheSnapshot)=>void)=>{listeners.add(listener);listener(snapshot());return()=>{listeners.delete(listener)}},setEnabled,clear,refresh,requestPersistence,bindAudio,dispose}
}
export type DeviceAudioCache=ReturnType<typeof createDeviceAudioCache>
