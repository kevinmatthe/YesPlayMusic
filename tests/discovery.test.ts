import { describe, expect, it, vi } from 'vitest'
import { loadDiscovery } from '../src/discovery'
import type { Track } from '../src/core'

const track=(id:string):Track=>({id,source:'netease',externalID:id.split(':')[1]!,title:id,artist:'Provider artist',album:'',picture:'',durationMs:120000})
describe('first-visit catalogue',()=>{
  it('renders the featured song before a slower search finishes',async()=>{
    let finish!:(tracks:Track[])=>void
    const pending=new Promise<Track[]>(resolve=>finish=resolve),update=vi.fn()
    const loading=loadDiscovery({details:async()=>[track('netease:347230')],search:()=>pending},update)
    await vi.waitFor(()=>expect(update).toHaveBeenCalledWith([track('netease:347230')]))
    finish([track('netease:2')])
    expect((await loading).length).toBe(2)
  })
  it('shows actual provider metadata, deduplicated by stable ID, without creating a personal playlist',async()=>{
    const api={details:vi.fn(async()=>[track('netease:347230')]),search:vi.fn(async()=>[track('netease:2'),track('netease:347230'),track('netease:3')])}
    expect((await loadDiscovery(api)).map(t=>t.id)).toEqual(['netease:347230','netease:2','netease:3'])
  })
  it('still displays search results when the featured recording is unavailable',async()=>{
    expect(await loadDiscovery({details:async()=>{throw new Error('unavailable')},search:async()=>[track('netease:2')]})).toEqual([track('netease:2')])
  })
  it('reports a catalogue outage instead of replacing music with synthetic tracks',async()=>{
    await expect(loadDiscovery({details:async()=>{throw new Error('outage')},search:async()=>{throw new Error('outage')}})).rejects.toThrow('曲库暂时无法连接')
  })
})
