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
export interface IdentityHost {isFeishu:boolean,requestCode:(appID:string)=>Promise<string>}
type IdentityApi=Pick<MusicApi,'authOptions'|'me'|'ensureGuest'|'exchangeFeishu'>
export interface IdentityResult {session:Session,options:AuthOptions,message:string}
const disabled:AuthOptions={guest:true,feishu:{enabled:false,appID:''}}

// URL open_id/owner_id and host-side user-info objects are never identity inputs.
export async function initializeIdentity(api:IdentityApi,host:IdentityHost):Promise<IdentityResult> {
  const options=await api.authOptions().catch(()=>disabled)
  let existing:Session|undefined
  try{existing=await api.me()}catch(e){if((e as {status?:number}).status!==401)throw e}
  if(existing)return {session:existing,options,message:existing.user.kind==='guest'&&options.feishu.enabled&&host.isFeishu?'当前保留访客空间。可在备份与恢复中切换到飞书个人空间。':''}
  let message=''
  if(options.feishu.enabled&&options.feishu.appID&&host.isFeishu){
    try{
      const code=await host.requestCode(options.feishu.appID)
      return {session:await api.exchangeFeishu(code),options,message:''}
    }catch{message='飞书身份暂未连接，已为你打开访客空间。'}
  }
  return {session:await api.ensureGuest(),options,message}
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
    try{if(host.h5sdk)host.h5sdk.ready(request);else request()}catch{finish(undefined,'飞书授权未完成。')}
  })
}

// SDK URL published by Feishu's H5 development guide (step-3, verified 2026-11-13).
const SDK_URL='https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.30.js'
let loading:Promise<void>|undefined
export function browserIdentityHost():IdentityHost {
  const host=window as unknown as SDKWindow
  const isFeishu=Boolean(host.tt?.requestAccess||host.tt?.requestAuthCode)||/Feishu|Lark\/|Lark\(/i.test(navigator.userAgent)
  return {isFeishu,async requestCode(appID){
    if(!isFeishu)throw new Error('请在飞书网页应用内连接身份。')
    if(!host.tt?.requestAccess&&!host.tt?.requestAuthCode){
      loading??=new Promise<void>((resolve,reject)=>{
        const script=document.createElement('script')
        const timer=setTimeout(()=>{script.remove();reject(new Error('飞书 SDK 加载超时。'))},6000)
        script.src=SDK_URL;script.async=true;script.referrerPolicy='no-referrer'
        script.onload=()=>{clearTimeout(timer);resolve()}
        script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('飞书 SDK 无法加载。'))}
        document.head.appendChild(script)
      }).catch(e=>{loading=undefined;throw e})
      await loading
    }
    return requestFeishuCode(appID,host)
  }}
}
