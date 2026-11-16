import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createIdentityNavigator, type IdentityHost } from '../src/identity'

const fixtures=vi.hoisted(()=>({
  player:{initialize:vi.fn(),pause:vi.fn(),saveQueue:vi.fn(),dispose:vi.fn()},
  api:{authOptions:vi.fn(),me:vi.fn(),ensureGuest:vi.fn(),exchangeFeishu:vi.fn(),refreshFeishuProfile:vi.fn(),listPlaylists:vi.fn(),likes:vi.fn(),history:vi.fn()},
  host:undefined as IdentityHost|undefined,
}))
vi.mock('../src/core',()=>({createPlayer:()=>fixtures.player,musicApi:fixtures.api}))
vi.mock('../src/identity',async importOriginal=>({...await importOriginal<typeof import('../src/identity')>(),browserIdentityHost:()=>fixtures.host!}))
import { useMusic } from '../src/stores/music'

const guest={user:{id:'guest-a',kind:'guest' as const},expiresAt:'2030-01-01T00:00:00Z'}
const origin='https://music.kmhomelab.cn:2443'
beforeEach(()=>{
  vi.clearAllMocks();setActivePinia(createPinia())
  fixtures.api.authOptions.mockResolvedValue({guest:true,feishu:{enabled:true,appID:'cli_verified'}})
  fixtures.api.me.mockResolvedValue(guest);fixtures.api.ensureGuest.mockResolvedValue(guest)
  fixtures.api.listPlaylists.mockResolvedValue([]);fixtures.api.likes.mockResolvedValue([]);fixtures.api.history.mockResolvedValue([])
})
afterEach(()=>vi.unstubAllGlobals())
function context(){
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const location={href:origin+'/library?trackID=netease%3A347230',replace:vi.fn(),assign:vi.fn()}
  fixtures.host={isFeishu:true,requestCode:vi.fn(async()=>'one-use-code'),navigation:createIdentityNavigator({location,storage})}
  vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('location',location)
  return {location,values}
}
describe('identity navigation gates music initialization',()=>{
  it('leaves the current document unready and starts no music APIs after full redirect',async()=>{
    const env=context();fixtures.api.me.mockRejectedValue({status:401})
    const music=useMusic()
    expect(await music.initialize()).toBe(false)
    expect(env.location.replace).toHaveBeenCalledWith('/play')
    expect(music.ready).toBe(false)
    expect(fixtures.player.initialize).not.toHaveBeenCalled()
    expect(fixtures.api.listPlaylists).not.toHaveBeenCalled()
    expect(fixtures.api.ensureGuest).not.toHaveBeenCalled()
  })
  it('keeps ordinary existing guests ready and loads their own player and lists',async()=>{
    context();const music=useMusic()
    expect(await music.initialize()).toBe(true)
    expect(music.ready).toBe(true)
    expect(fixtures.player.initialize).toHaveBeenCalledTimes(1)
    expect(fixtures.api.listPlaylists).toHaveBeenCalledTimes(1)
    expect(fixtures.api.exchangeFeishu).not.toHaveBeenCalled()
  })
  it('explicit connect saves the current queue and redirects once without disposing or exchanging on the old page',async()=>{
    const env=context(),music=useMusic();await music.initialize()
    await music.connectFeishu()
    expect(fixtures.player.pause).toHaveBeenCalledTimes(1)
    expect(fixtures.player.saveQueue).toHaveBeenCalledTimes(1)
    expect(fixtures.player.dispose).not.toHaveBeenCalled()
    expect(fixtures.host!.requestCode).not.toHaveBeenCalled()
    expect(fixtures.api.exchangeFeishu).not.toHaveBeenCalled()
    expect(env.location.replace).toHaveBeenCalledExactlyOnceWith('/play')
    const pending=JSON.parse([...env.values.values()][0]!)
    expect(pending).toMatchObject({kind:'connect',guestID:'guest-a',appID:'cli_verified'})
    expect([...env.values.values()].join('')).not.toContain('one-use-code')
  })
})
