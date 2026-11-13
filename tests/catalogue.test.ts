import { describe, expect, it, vi } from 'vitest'
import { createMusicApi } from '../src/core/api'

const track={id:'kuwo:629335603',source:'kuwo',externalID:'629335603',title:'小星星 (伴奏版)',artist:'贝乐虎儿歌',album:'贝乐虎儿歌大全',picture:'',durationMs:75000}

describe('explicit catalogue source',()=>{
 it('keeps default search unchanged and encodes an explicit source separately from the query',async()=>{
  const fetcher=vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({tracks:[track]})))
  const api=createMusicApi(fetcher)
  await api.search('Beyond')
  expect(fetcher.mock.calls[0]?.[0]).toBe('/music-api/v1/search?q=Beyond')
  const tracks=await api.search('海阔天空&source=netease','kuwo')
  expect(fetcher.mock.calls[1]?.[0]).toBe('/music-api/v1/search?q='+encodeURIComponent('海阔天空&source=netease')+'&source=kuwo')
  expect(tracks[0]?.id).toBe('kuwo:629335603')
  expect(tracks[0]?.title).toContain('伴奏版')
 })
 it('discovers configured source labels without requesting an account or endpoint secret',async()=>{
  const options={defaultSource:'netease',sources:[{id:'netease',name:'网易云'},{id:'kuwo',name:'酷我'}]}
  const fetcher=vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify(options)))
  expect(await createMusicApi(fetcher).catalogOptions()).toEqual(options)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/music-api/v1/catalog/options')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({method:'GET',credentials:'same-origin'})
 })
})
