import { describe, expect, it, vi } from 'vitest'
import { initializeIdentity, requestFeishuCode } from '../src/identity'

const guest={user:{id:'guest-a',kind:'guest' as const},expiresAt:'2030-01-01T00:00:00Z'}
const feishu={...guest,user:{id:'verified-user',kind:'feishu' as const}}
const options={guest:true,feishu:{enabled:true,appID:'cli_from_server'}}
function api(existing:typeof guest|typeof feishu|undefined=undefined){return {
  authOptions:vi.fn(async()=>options),
  me:vi.fn(async()=>{if(!existing)throw {status:401};return existing}),
  ensureGuest:vi.fn(async()=>guest),
  exchangeFeishu:vi.fn(async()=>feishu),
}}
describe('verified identity bootstrap',()=>{
  it('creates a visitor outside Feishu without requesting any host login state',async()=>{
    const service=api(),host={isFeishu:false,requestCode:vi.fn()}
    expect((await initializeIdentity(service,host)).session).toEqual(guest)
    expect(host.requestCode).not.toHaveBeenCalled()
  })
  it('exchanges only the temporary code using the server-advertised app ID',async()=>{
    const service=api(),host={isFeishu:true,requestCode:vi.fn(async()=>'temporary-code')}
    expect((await initializeIdentity(service,host)).session).toEqual(feishu)
    expect(host.requestCode).toHaveBeenCalledWith('cli_from_server')
    expect(service.exchangeFeishu).toHaveBeenCalledExactlyOnceWith('temporary-code')
    expect(service.ensureGuest).not.toHaveBeenCalled()
  })
  it('keeps an existing guest space until the user explicitly changes account',async()=>{
    const service=api(guest),host={isFeishu:true,requestCode:vi.fn()}
    expect((await initializeIdentity(service,host)).session).toEqual(guest)
    expect(host.requestCode).not.toHaveBeenCalled()
    expect(service.exchangeFeishu).not.toHaveBeenCalled()
  })
  it('keeps the page usable when Feishu is unconfigured or host authorization fails',async()=>{
    const service=api(),host={isFeishu:true,requestCode:vi.fn(async()=>{throw new Error('refused')})}
    expect((await initializeIdentity(service,host)).message).toContain('访客')
    service.authOptions.mockResolvedValue({guest:true,feishu:{enabled:false,appID:''}})
    host.requestCode.mockClear()
    expect((await initializeIdentity(service,host)).session).toEqual(guest)
    expect(host.requestCode).not.toHaveBeenCalled()
  })
  it('does not disguise service failures as an expired identity',async()=>{
    const service=api()
    service.me.mockRejectedValue({status:503})
    await expect(initializeIdentity(service,{isFeishu:false,requestCode:vi.fn()})).rejects.toEqual({status:503})
    expect(service.ensureGuest).not.toHaveBeenCalled()
  })
})
describe('Feishu callback protocol',()=>{
  it('uses requestAccess and only falls back on unsupported-client errno103',async()=>{
    const legacy=vi.fn(({success})=>success({code:'old-client-code'}))
    const tt={requestAccess:vi.fn(({fail})=>fail({errno:103})),requestAuthCode:legacy}
    expect(await requestFeishuCode('cli_one',{tt},100)).toBe('old-client-code')
    expect(legacy.mock.calls[0]?.[0].appId).toBe('cli_one')
  })
  it('never turns authorization refusal into a fallback request',async()=>{
    const legacy=vi.fn(),tt={requestAccess:vi.fn(({fail})=>fail({errno:20001})),requestAuthCode:legacy}
    await expect(requestFeishuCode('cli_one',{tt},100)).rejects.toThrow('授权')
    expect(legacy).not.toHaveBeenCalled()
  })
  it('bounds a host that never calls its callbacks',async()=>{
    await expect(requestFeishuCode('cli_one',{tt:{requestAccess:vi.fn()}},10)).rejects.toThrow('超时')
  })
})
