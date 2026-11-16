import { describe, expect, it, vi } from 'vitest'
import { createIdentityNavigator, IdentityNavigation, initializeIdentity } from '../src/identity'
import type { Session } from '../src/core'

const origin='https://music.kmhomelab.cn:2443'
const original:Session={user:{id:'verified-a',kind:'feishu',profileNeedsRefresh:true},expiresAt:'2030-01-01T00:00:00Z'}
const updated:Session={...original,user:{...original.user,displayName:'模拟昵称',avatarURL:'https://avatar.example/qa.jpg',profileUpdatedAt:'2026-11-16T00:00:00Z',profileNeedsRefresh:false}}
function setup(route='/library?trackID=netease%3A347230'){
  const values=new Map<string,string>(),clock={value:1800000000000}
  const location={href:origin+route,replace:vi.fn((path:string)=>{location.href=new URL(path,origin).href})}
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const navigation=createIdentityNavigator({location,storage,now:()=>clock.value})
  const host={isFeishu:true,navigation,requestCode:vi.fn(async()=>'temporary-profile-code')}
  const api={authOptions:vi.fn(async()=>({guest:true,feishu:{enabled:true,appID:'cli_profile'}})),me:vi.fn(async()=>original),ensureGuest:vi.fn(),exchangeFeishu:vi.fn(),refreshFeishuProfile:vi.fn(async()=>updated)}
  return {values,clock,location,navigation,host,api}
}
describe('same-identity profile update',()=>{
  it('sends an old verified session to canonical /play before refreshing missing profile',async()=>{
    const env=setup()
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(env.location.replace).toHaveBeenCalledExactlyOnceWith('/play')
    expect(env.api.refreshFeishuProfile).not.toHaveBeenCalled()
    expect(env.host.requestCode).not.toHaveBeenCalled()
    const stored=[...env.values.values()].join('')
    expect(stored).toContain('verified-a');expect(stored).not.toMatch(/temporary-profile-code|模拟昵称|avatar\.example/)
  })
  it('consumes a bound one-shot intent and updates through profile endpoint without exchanging sessions',async()=>{
    const env=setup()
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    env.host.requestCode.mockImplementation(async()=>{expect([...env.values.values()].some(raw=>raw.includes('"kind":"profile"'))).toBe(false);return 'temporary-profile-code'})
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(env.api.refreshFeishuProfile).toHaveBeenCalledExactlyOnceWith('temporary-profile-code')
    expect(env.api.exchangeFeishu).not.toHaveBeenCalled();expect(env.api.ensureGuest).not.toHaveBeenCalled()
    expect(env.location.replace).toHaveBeenLastCalledWith('/library?trackID=netease%3A347230')
    // Even a stale /me response on the return page must not start an automatic loop.
    expect((await initializeIdentity(env.api,env.host)).session.user.id).toBe(original.user.id)
    expect(env.host.requestCode).toHaveBeenCalledTimes(1)
  })
  it('accepts the same session expiry instant serialized in another timezone',async()=>{
    const env=setup('/play'),sameInstant={...updated,expiresAt:'2030-01-01T08:00:00+08:00'}
    env.api.refreshFeishuProfile.mockResolvedValue(sameInstant)
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect((await initializeIdentity(env.api,env.host)).session).toEqual(sameInstant)
    expect(env.api.exchangeFeishu).not.toHaveBeenCalled()
  })
  it.each(['sdk failure','endpoint failure','wrong user','changed expiry','invalid expiry'])('preserves the current verified identity after %s and prevents automatic retry loops',async mode=>{
    const env=setup()
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    if(mode==='sdk failure')env.host.requestCode.mockRejectedValue(new Error('refused'))
    if(mode==='endpoint failure')env.api.refreshFeishuProfile.mockRejectedValue(new Error('upstream unavailable'))
    if(mode==='wrong user')env.api.refreshFeishuProfile.mockResolvedValue({...updated,user:{...updated.user,id:'different-user'}})
    if(mode==='changed expiry')env.api.refreshFeishuProfile.mockResolvedValue({...updated,expiresAt:'2031-01-01T00:00:00Z'})
    if(mode==='invalid expiry')env.api.refreshFeishuProfile.mockResolvedValue({...updated,expiresAt:'not-a-date'})
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    const result=await initializeIdentity(env.api,env.host)
    expect(result.session).toEqual(original)
    expect(env.host.requestCode).toHaveBeenCalledTimes(1)
    expect(env.api.exchangeFeishu).not.toHaveBeenCalled();expect(env.api.ensureGuest).not.toHaveBeenCalled()
  })
  it('automatically retries only after the finite metadata cooldown expires',async()=>{
    const env=setup();env.api.refreshFeishuProfile.mockRejectedValue(new Error('offline'))
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect((await initializeIdentity(env.api,env.host)).session).toEqual(original)
    env.clock.value+=15*60*1000+1
    await expect(initializeIdentity(env.api,env.host)).rejects.toBeInstanceOf(IdentityNavigation)
    expect(env.location.replace).toHaveBeenLastCalledWith('/play')
  })
  it('supports explicit retry without requiring logout or losing the same session expiry',async()=>{
    const env=setup('/play');env.api.me.mockResolvedValue(updated)
    expect(()=>env.navigation.beginProfile('cli_profile',updated.user.id,true)).toThrow(IdentityNavigation)
    const result=await initializeIdentity(env.api,env.host)
    expect(result.session).toEqual(updated)
    expect(result.session.expiresAt).toBe(original.expiresAt)
    expect(env.api.refreshFeishuProfile).toHaveBeenCalledTimes(1)
    expect(()=>env.navigation.beginProfile('cli_profile',updated.user.id,true)).toThrow(IdentityNavigation)
  })
  it('drops profile intents that belong to another verified account',async()=>{
    const env=setup('/play');env.api.me.mockResolvedValue(updated)
    expect(()=>env.navigation.beginProfile('cli_profile','someone-else',true)).toThrow(IdentityNavigation)
    expect((await initializeIdentity(env.api,env.host)).session).toEqual(updated)
    expect(env.host.requestCode).not.toHaveBeenCalled()
    expect(env.api.refreshFeishuProfile).not.toHaveBeenCalled()
  })
  it('does not refresh guests or verified profiles outside Feishu',async()=>{
    const env=setup();env.host.isFeishu=false
    expect((await initializeIdentity(env.api,env.host)).session).toEqual(original)
    expect(env.location.replace).not.toHaveBeenCalled();expect(env.host.requestCode).not.toHaveBeenCalled()
    env.host.isFeishu=true;env.api.me.mockResolvedValue({user:{id:'visitor',kind:'guest',profileNeedsRefresh:true},expiresAt:original.expiresAt})
    expect((await initializeIdentity(env.api,env.host)).session.user.kind).toBe('guest')
    expect(env.location.replace).not.toHaveBeenCalled();expect(env.api.refreshFeishuProfile).not.toHaveBeenCalled()
  })
})
