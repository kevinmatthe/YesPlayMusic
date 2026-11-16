import type { AuthOptions, MusicApi, Session } from './core'

type CodeResult={code?:string}
type SDKFailure={errno?:number}
type CallOptions={success:(result:CodeResult)=>void,fail:(error:SDKFailure)=>void}
interface SDKWindow {
  tt?: {
    requestAccess?:(options:CallOptions&{appID:string,scopeList:string[]})=>void
    requestAuthCode?:(options:CallOptions&{appId:string})=>void
  }
  h5sdk?:{ready:(callback:()=>void)=>void}
}
export interface IdentityHost {isFeishu:boolean,requestCode:(appID:string)=>Promise<string>,navigation?:IdentityNavigator}
type IdentityApi=Pick<MusicApi,'authOptions'|'me'|'ensureGuest'|'exchangeFeishu'>
export interface IdentityResult {session:Session,options:AuthOptions,message:string}
const disabled:AuthOptions={guest:true,feishu:{enabled:false,appID:''}}

/** Stops the current document before it can initialize a player or use old-route parameters. */
export class IdentityNavigation extends Error {
  constructor(readonly destination:string){super('正在切换身份验证页面。');this.name='IdentityNavigation'}
}
type Intent={version:1,kind:'fresh'|'connect',appID:string,guestID?:string,returnRoute:string,createdAt:number}
type NavigationEnvironment={location:{href:string,replace:(route:string)=>void},storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,now?:()=>number}
export interface IdentityNavigator {
  requirePlay:(appID:string)=>void
  beginConnect:(appID:string,guestID:string)=>never
  consume:(appID:string,user?:Session['user'])=>Intent|undefined
  complete:(intent:Intent|undefined,message:string)=>void
}
const INTENT_KEY='betago:feishu-intent-v1'
const INTENT_TTL=5*60*1000
const credentialKey=/^(?:code|token|access_token|refresh_token|id_token|sessionToken|session_token|music_session|recoveryCode|recovery_code)$/i

function safeReturnRoute(value:unknown,origin:string):string|undefined {
  if(typeof value!=='string'||!value||value.length>8192||/[\\\u0000-\u0020\u007f]/.test(value)||value.startsWith('//'))return
  try{
    const url=new URL(value,origin+'/')
    if(url.origin!==origin||url.username||url.password||!/^https?:$/.test(url.protocol))return
    // Only application routes can be a return destination, never an API or an external redirect.
    if(!/^\/(?:library|search|queue|play|history|likes|shares)$/.test(url.pathname)&&!/^\/share\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname))return
    for(const key of [...url.searchParams.keys()])if(credentialKey.test(key))url.searchParams.delete(key)
    if(/(?:^|[?&#])(?:code|token|access_token|refresh_token|id_token|sessionToken|recoveryCode)=/i.test(url.hash.slice(1)))url.hash=''
    return url.pathname+url.search+url.hash
  }catch{return}
}

/** Full document navigation is required: Feishu's redirect list does not cover dynamic SPA paths. */
export function createIdentityNavigator(env:NavigationEnvironment):IdentityNavigator {
  const now=env.now??Date.now
  function clear(){try{env.storage.removeItem(INTENT_KEY)}catch{/* Guest mode remains usable if browser storage is disabled. */}}
  function current(){return new URL(env.location.href)}
  function move(route:string):never{env.location.replace(route);throw new IdentityNavigation(route)}
  function start(kind:Intent['kind'],appID:string,guestID?:string):never {
    const url=current(),returnRoute=safeReturnRoute(url.href,url.origin)
    if(!returnRoute||!appID||(kind==='connect'&&!guestID))throw new Error('无法保存身份切换入口，请在播放器页重试。')
    // Only route and one-shot intent metadata are stored; code and session credentials stay in memory/cookies.
    env.storage.setItem(INTENT_KEY,JSON.stringify({version:1,kind,appID,guestID,returnRoute,createdAt:now()} satisfies Intent))
    return move('/play')
  }
  return {
    requirePlay(appID){if(current().pathname!=='/play')start('fresh',appID)},
    beginConnect:(appID,guestID)=>start('connect',appID,guestID),
    consume(appID,user){
      let raw:string|null
      try{raw=env.storage.getItem(INTENT_KEY)}catch{return}
      if(!raw)return
      clear() // Consume before any asynchronous SDK call, even for refused or abandoned attempts.
      try{
        const value=JSON.parse(raw) as Intent,url=current(),age=now()-value.createdAt
        const returnRoute=safeReturnRoute(value.returnRoute,url.origin)
        if(url.pathname!=='/play'||value.version!==1||!['fresh','connect'].includes(value.kind)||value.appID!==appID||!Number.isFinite(age)||age<0||age>INTENT_TTL||!returnRoute)return
        if(value.kind==='connect'&&(user?.kind!=='guest'||!value.guestID||value.guestID!==user.id))return
        return {...value,returnRoute}
      }catch{return}
    },
    complete(intent,message){
      if(!intent)return
      const url=current(),route=safeReturnRoute(intent.returnRoute,url.origin)
      if(!route||route===url.pathname+url.search+url.hash)return
      if(message)try{env.storage.setItem('betago:auth-notice',message)}catch{/* Navigation can still finish. */}
      move(route)
    },
  }
}

// URL open_id/owner_id and host-side user-info objects are never identity inputs.
export async function initializeIdentity(api:IdentityApi,host:IdentityHost):Promise<IdentityResult> {
  const options=await api.authOptions().catch(()=>disabled)
  let existing:Session|undefined
  try{existing=await api.me()}catch(e){if((e as {status?:number}).status!==401)throw e}
  const intent=host.navigation?.consume(options.feishu.appID,existing?.user)
  const explicitConnect=existing?.user.kind==='guest'&&intent?.kind==='connect'
  if(existing&&!explicitConnect){
    const message=existing.user.kind==='guest'&&options.feishu.enabled&&host.isFeishu?'当前保留访客空间。可在备份与恢复中切换到飞书个人空间。':''
    host.navigation?.complete(intent,message)
    return {session:existing,options,message}
  }
  let message=''
  let session:Session|undefined
  if(options.feishu.enabled&&options.feishu.appID&&host.isFeishu){
    try{
      host.navigation?.requirePlay(options.feishu.appID)
      const code=await host.requestCode(options.feishu.appID)
      session=await api.exchangeFeishu(code)
    }catch(error){
      if(error instanceof IdentityNavigation)throw error
      message=existing?'飞书身份暂未连接，仍保留原访客空间。':'飞书身份暂未连接，已为你打开访客空间。'
    }
  }
  session??=existing??await api.ensureGuest()
  host.navigation?.complete(intent,message)
  return {session,options,message}
}

/** Official callback protocol; unsupported-client fallback only, never refusal fallback. */
export function requestFeishuCode(appID:string,host:SDKWindow,timeoutMs=8000):Promise<string>{
  return new Promise((resolve,reject)=>{
    let settled=false
    const timer=setTimeout(()=>finish(undefined,'飞书授权超时，请稍后再试。'),timeoutMs)
    function finish(code?:string,error?:string){if(settled)return;settled=true;clearTimeout(timer);code?resolve(code):reject(new Error(error||'未能获取飞书授权。'))}
    const callbacks:CallOptions={success:result=>finish(result.code),fail:()=>finish(undefined,'飞书授权未完成。')}
    function legacy(){if(!host.tt?.requestAuthCode){finish(undefined,'当前飞书版本不支持网页授权。');return}host.tt.requestAuthCode({appId:appID,...callbacks})}
    function request(){try{
      if(host.tt?.requestAccess)host.tt.requestAccess({appID,scopeList:[],success:callbacks.success,fail:error=>{if(settled)return;if(error.errno===103)legacy();else callbacks.fail(error)}})
      else legacy()
    }catch{finish(undefined,'飞书授权未完成。')}}
    if(!host.h5sdk?.ready){finish(undefined,'飞书 SDK 尚未就绪。');return}
    try{host.h5sdk.ready(request)}catch{finish(undefined,'飞书授权未完成。')}
  })
}

// SDK URL published by Feishu's H5 development guide (step-3, verified 2026-11-13).
const SDK_URL='https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.30.js'
let loading:Promise<void>|undefined
export function browserIdentityHost():IdentityHost {
  const host=window as unknown as SDKWindow
  const isFeishu=Boolean(host.tt?.requestAccess||host.tt?.requestAuthCode)||/Feishu|Lark\/|Lark\(/i.test(navigator.userAgent)
  const storage={getItem:(key:string)=>window.sessionStorage.getItem(key),setItem:(key:string,value:string)=>window.sessionStorage.setItem(key,value),removeItem:(key:string)=>window.sessionStorage.removeItem(key)}
  const navigation=createIdentityNavigator({location:window.location,storage})
  return {isFeishu,navigation,async requestCode(appID){
    if(!isFeishu)throw new Error('请在飞书网页应用内连接身份。')
    if(!host.h5sdk?.ready){
      loading??=new Promise<void>((resolve,reject)=>{
        const script=document.createElement('script')
        const timer=setTimeout(()=>{script.remove();reject(new Error('飞书 SDK 加载超时。'))},6000)
        script.src=SDK_URL;script.async=true;script.referrerPolicy='no-referrer'
        script.onload=()=>{clearTimeout(timer);resolve()}
        script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('飞书 SDK 无法加载。'))}
        document.head.appendChild(script)
      }).catch(e=>{loading=undefined;throw e})
      await loading
      if(!host.h5sdk?.ready){loading=undefined;throw new Error('飞书 SDK 尚未就绪。')}
    }
    return requestFeishuCode(appID,host)
  }}
}
