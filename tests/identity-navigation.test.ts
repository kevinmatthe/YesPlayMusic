import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdentityNavigator, IdentityNavigation, initializeIdentity, requestFeishuCode } from '../src/identity'

const origin='https://music.kmhomelab.cn:2443'
const guest={user:{id:'guest-a',kind:'guest' as const},expiresAt:'2030-01-01T00:00:00Z'}
const feishu={...guest,user:{id:'verified-user',kind:'feishu' as const}}
const options={guest:true,feishu:{enabled:true,appID:'cli_verified_app'}}
function service(existing:typeof guest|typeof feishu|undefined=undefined){return {
  authOptions:vi.fn(async()=>options),
  me:vi.fn(async()=>{if(!existing)throw {status:401};return existing}),
  ensureGuest:vi.fn(async()=>guest),exchangeFeishu:vi.fn(async()=>feishu),
}}
function environment(route='/library'){
  const values=new Map<string,string>(),clock={value:1800000000000}
  const location={href:origin+route,replace:vi.fn((route:string)=>{location.href=new URL(route,origin).href})}
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const navigation=createIdentityNavigator({location,storage,now:()=>clock.value})
  const host={isFeishu:true,navigation,requestCode:vi.fn(async()=>'temporary-code-only-in-memory')}
  function mutate(fn:(value:Record<string,unknown>)=>void){const[key,raw]=[...values.entries()][0]!;const value=JSON.parse(raw);fn(value);values.set(key,JSON.stringify(value))}
  return {values,clock,location,storage,navigation,host,mutate}
}
afterEach(()=>vi.unstubAllGlobals())

describe('one exact full-navigation Feishu authorization route',()=>{
  it('moves a fresh visitor from a share/query route to /play before calling the SDK',async()=>{
    const route='/share/public_share?trackID=netease%3A347230&target=https%3A%2F%2Fexample.test%2Finfo%2F347230.json#verse'
    const env=environment(route),api=service()
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(env.location.replace).toHaveBeenCalledExactlyOnceWith('/play')
    expect(env.host.requestCode).not.toHaveBeenCalled()
    expect(api.ensureGuest).not.toHaveBeenCalled()
    expect(api.exchangeFeishu).not.toHaveBeenCalled()
    expect(JSON.parse([...env.values.values()][0]!).returnRoute).toBe(route)
    expect([...env.values.values()].join('')).not.toMatch(/temporary-code|access_token|sessionToken/)
  })
  it('consumes the fresh intent before SDK and restores the exact old route after verified exchange',async()=>{
    const env=environment('/queue?trackID=netease%3A347230'),api=service()
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    env.host.requestCode.mockImplementation(async()=>{expect(env.values.size).toBe(0);return 'temporary-code-only-in-memory'})
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(api.exchangeFeishu).toHaveBeenCalledExactlyOnceWith('temporary-code-only-in-memory')
    expect(env.location.replace.mock.calls.map(call=>call[0])).toEqual(['/play','/queue?trackID=netease%3A347230'])
    expect(env.values.size).toBe(0)
    const already=service(feishu)
    expect((await initializeIdentity(already,env.host)).session).toEqual(feishu)
    expect(env.host.requestCode).toHaveBeenCalledTimes(1)
  })
  it('authenticates directly on /play while preserving target and trackID in its live URL',async()=>{
    const env=environment('/play?target=https%3A%2F%2Fexample.test%2Fdescriptor.json&trackID=netease%3A347230'),api=service()
    expect((await initializeIdentity(api,env.host)).session).toEqual(feishu)
    expect(env.location.replace).not.toHaveBeenCalled()
    expect(env.values.size).toBe(0)
    expect(env.location.href).toContain('target=')
  })
  it('keeps an existing guest without automatic authorization or migration',async()=>{
    const env=environment('/history'),api=service(guest)
    expect((await initializeIdentity(api,env.host)).session).toEqual(guest)
    expect(env.location.replace).not.toHaveBeenCalled()
    expect(env.host.requestCode).not.toHaveBeenCalled()
    expect(api.exchangeFeishu).not.toHaveBeenCalled()
  })
  it('allows one explicit guest connect, including from /play, and never persists its code',async()=>{
    const env=environment('/play?trackID=netease%3A347230'),api=service(guest)
    expect(()=>env.navigation.beginConnect(options.feishu.appID,guest.user.id)).toThrow(IdentityNavigation)
    expect(env.location.replace).toHaveBeenCalledExactlyOnceWith('/play')
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(api.exchangeFeishu).toHaveBeenCalledExactlyOnceWith('temporary-code-only-in-memory')
    expect(env.location.replace).toHaveBeenLastCalledWith('/play?trackID=netease%3A347230')
    expect(env.values.size).toBe(0)
    expect(api.ensureGuest).not.toHaveBeenCalled()
  })
  it.each(['sdk','exchange'])('keeps the original guest after %s refusal, restores the page, and cannot loop',async failure=>{
    const env=environment('/likes?view=all'),api=service(guest)
    expect(()=>env.navigation.beginConnect(options.feishu.appID,guest.user.id)).toThrow(IdentityNavigation)
    if(failure==='sdk')env.host.requestCode.mockRejectedValue(new Error('refused'))
    else api.exchangeFeishu.mockRejectedValue(new Error('code rejected'))
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect([...env.values.keys()]).toEqual(['betago:auth-notice'])
    expect([...env.values.values()].join('')).not.toMatch(/temporary-code|code rejected/)
    expect(env.location.replace).toHaveBeenLastCalledWith('/likes?view=all')
    expect((await initializeIdentity(api,env.host)).session).toEqual(guest)
    expect(env.host.requestCode).toHaveBeenCalledTimes(1)
    expect(api.ensureGuest).not.toHaveBeenCalled()
  })
  it('restores a fresh visitor route through a guest fallback after refusal without a second attempt',async()=>{
    const env=environment('/search?query=music'),api=service()
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    env.host.requestCode.mockRejectedValue(new Error('refused'))
    await expect(initializeIdentity(api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(api.ensureGuest).toHaveBeenCalledTimes(1)
    expect(env.location.replace).toHaveBeenLastCalledWith('/search?query=music')
    expect((await initializeIdentity(service(guest),env.host)).session).toEqual(guest)
    expect(env.host.requestCode).toHaveBeenCalledTimes(1)
  })
  it('does not swallow a navigation signal into guest fallback',async()=>{
    const api=service(),host={isFeishu:true,requestCode:vi.fn(async()=>{throw new IdentityNavigation('/play')})}
    await expect(initializeIdentity(api,host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(api.ensureGuest).not.toHaveBeenCalled()
  })
  it.each(['expired','future','different guest','different app','non-play reentry'])('drops %s connect intent rather than authorizing another session',async variant=>{
    const env=environment('/queue'),api=service(guest)
    expect(()=>env.navigation.beginConnect(options.feishu.appID,guest.user.id)).toThrow(IdentityNavigation)
    if(variant==='expired')env.clock.value+=5*60*1000+1
    if(variant==='future')env.clock.value-=60*1000
    if(variant==='different guest')env.mutate(value=>{value.guestID='guest-b'})
    if(variant==='different app')env.mutate(value=>{value.appID='cli_other_app'})
    if(variant==='non-play reentry')env.location.href=origin+'/library'
    expect((await initializeIdentity(api,env.host)).session).toEqual(guest)
    expect(env.host.requestCode).not.toHaveBeenCalled()
    expect(api.exchangeFeishu).not.toHaveBeenCalled()
    expect(env.values.size).toBe(0)
  })
  it.each(['//evil.test/x','/\\evil.test/x','/%5cevil.test','https://evil.test/play','javascript:alert(1)','https://user@music.kmhomelab.cn:2443/library','/music-api/v1/auth/logout','/play\n//evil.test'])('drops unsafe stored return URL %s',async bad=>{
    const env=environment('/queue'),api=service(guest)
    expect(()=>env.navigation.beginConnect(options.feishu.appID,guest.user.id)).toThrow(IdentityNavigation)
    env.mutate(value=>{value.returnRoute=bad});env.location.replace.mockClear()
    expect((await initializeIdentity(api,env.host)).session).toEqual(guest)
    expect(env.host.requestCode).not.toHaveBeenCalled()
    expect(env.location.replace).not.toHaveBeenCalled()
    expect(env.values.size).toBe(0)
  })
  it('strips authorization credentials from stored query while retaining music link parameters',()=>{
    const env=environment('/queue?code=do-not-store&access_token=secret&trackID=netease%3A347230&source=netease#access_token=hidden')
    expect(()=>env.navigation.beginConnect(options.feishu.appID,guest.user.id)).toThrow(IdentityNavigation)
    const raw=[...env.values.values()].join('')
    expect(raw).not.toMatch(/do-not-store|access_token|secret|hidden/)
    expect(JSON.parse(raw).returnRoute).toBe('/queue?trackID=netease%3A347230&source=netease')
  })
})

describe('official SDK readiness, including injected tt bridge',()=>{
  it('never calls an injected tt bridge without h5sdk.ready',async()=>{
    const requestAccess=vi.fn(({success})=>success({code:'unsafe-early-code'}))
    await expect(requestFeishuCode('cli_app',{tt:{requestAccess}},20)).rejects.toThrow('就绪')
    expect(requestAccess).not.toHaveBeenCalled()
  })
  it('waits for readiness before using requestAccess',async()=>{
    let ready:(()=>void)|undefined
    const requestAccess=vi.fn(({success})=>success({code:'ready-code'}))
    const pending=requestFeishuCode('cli_app',{tt:{requestAccess},h5sdk:{ready:cb=>{ready=cb}}},100)
    expect(requestAccess).not.toHaveBeenCalled();ready!()
    expect(await pending).toBe('ready-code')
  })
  it('loads the official SDK when tt already exists but h5sdk is absent, then waits for ready',async()=>{
    vi.resetModules()
    const identity=await import('../src/identity')
    let onReady:(()=>void)|undefined
    const requestAccess=vi.fn(({success})=>success({code:'browser-ready-code'}))
    const host:{tt:{requestAccess:typeof requestAccess},h5sdk?:{ready:(cb:()=>void)=>void},location:{href:string,replace:ReturnType<typeof vi.fn>},sessionStorage:ReturnType<typeof environment>['storage']}={tt:{requestAccess},location:{href:origin+'/play',replace:vi.fn()},sessionStorage:environment().storage}
    let script:{onload?:()=>void,onerror?:()=>void,remove:()=>void,src?:string}|undefined
    const appendChild=vi.fn((node:typeof script)=>{script=node})
    vi.stubGlobal('window',host);vi.stubGlobal('navigator',{userAgent:'Feishu/7.50'})
    vi.stubGlobal('document',{createElement:()=>({remove:vi.fn()}),head:{appendChild}})
    const pending=identity.browserIdentityHost().requestCode('cli_app')
    expect(appendChild).toHaveBeenCalledTimes(1)
    expect(script?.src).toBe('https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.30.js')
    expect(requestAccess).not.toHaveBeenCalled()
    host.h5sdk={ready:cb=>{onReady=cb}};script!.onload!();await Promise.resolve();await Promise.resolve()
    expect(requestAccess).not.toHaveBeenCalled();onReady!()
    expect(await pending).toBe('browser-ready-code')
  })
})
