import {describe,it,expect,vi} from 'vitest'
import {loadDiscovery} from '../src/discovery'
import type {Track} from '../src/core'
const track=(id:string):Track=>({id,source:'netease',externalID:id,title:id,artist:'Provider',album:'',picture:'',durationMs:120000})
describe('server discovery candidates',()=>{
 it('uses server metadata, deduplicates stable IDs and never invents fixed artist requests',async()=>{
  const api={recommendations:vi.fn(async()=>({tracks:[track('a'),track('b'),track('a')].map(t=>({track:t,basis:'discovery' as const,reason:''})),personalized:false}))},update=vi.fn()
  expect((await loadDiscovery(api,update)).map(t=>t.id)).toEqual(['a','b']);expect(api.recommendations).toHaveBeenCalledExactlyOnceWith(8,undefined);expect(update).toHaveBeenCalledTimes(1)
 })
 it('keeps a real empty result empty instead of requesting a fixed song',async()=>{expect(await loadDiscovery({recommendations:async()=>({tracks:[],personalized:false})})).toEqual([])})
 it('exposes an outage for local retry',async()=>{await expect(loadDiscovery({recommendations:async()=>{throw new Error('outage')}})).rejects.toThrow('outage')})
 it('does not publish a result after cancellation even if a provider ignores its signal',async()=>{
  const controller=new AbortController(),update=vi.fn();controller.abort();expect(await loadDiscovery({recommendations:async()=>({tracks:[],personalized:false})},update,controller.signal)).toEqual([]);expect(update).not.toHaveBeenCalled()
 })
})
