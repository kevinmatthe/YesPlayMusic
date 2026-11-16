import { describe, expect, it, vi } from 'vitest'
import { createSourceSearch, explicitSearchQuery } from '../src/source-search'
import type { Track } from '../src/core'
const track=(source:string):Track=>({id:source+':123',source,externalID:'123',title:'Same title (Live)',artist:source,album:'edition',picture:'',durationMs:75000})
describe('catalogue source switching',()=>{
 it('records only an explicitly submitted search, not background discovery or source refresh',async()=>{
  const record=vi.fn(),search=createSourceSearch({search:vi.fn(async()=>[track('netease')])},record)
  await search.run('background');expect(record).not.toHaveBeenCalled()
  await search.run('  own query  ',true);expect(record).toHaveBeenCalledExactlyOnceWith('own query','netease')
  await search.run('  ',true);expect(record).toHaveBeenCalledTimes(1)
 })
 it('accepts only a bounded string q from an explicit route, never owner inputs',()=>{
  expect(explicitSearchQuery('  Beyond  ')).toBe('Beyond')
  expect(explicitSearchQuery(['first','second'])).toBe('')
  expect(explicitSearchQuery({open_id:'spoof'})).toBe('')
  expect(explicitSearchQuery('x'.repeat(201))).toHaveLength(200)
 })
 it('discards a late previous platform response and preserves exact selected IDs',async()=>{
  let finish!:(value:Track[])=>void
  const api={search:vi.fn((_q:string,source?:string)=>source==='netease'?new Promise<Track[]>(resolve=>finish=resolve):Promise.resolve([track('kuwo')]))}
  const search=createSourceSearch(api)
  const old=search.run('same')
  search.select('kuwo')
  await search.run('same')
  finish([track('netease')]);await old
  expect(search.state.results.map(t=>t.id)).toEqual(['kuwo:123'])
  expect(search.state.source).toBe('kuwo')
  expect(search.state.searching).toBe(false)
 })
 it('ignores an old platform failure after a new selection',async()=>{
  let reject!:(error:Error)=>void
  const search=createSourceSearch({search:()=>new Promise<Track[]>((_resolve,fail)=>reject=fail)})
  const old=search.run('same')
  search.select('kuwo')
  reject(new Error('old source unavailable'))
  await expect(old).resolves.toBeUndefined()
  expect(search.state.results).toEqual([])
  expect(search.state.searched).toBe(false)
 })
 it('reports the selected platform failure without silently querying another platform',async()=>{
  const api={search:vi.fn(async()=>{throw new Error('selected source unavailable')})}
  const search=createSourceSearch(api);search.select('kuwo')
  await expect(search.run('same')).rejects.toThrow('selected source unavailable')
  expect(api.search).toHaveBeenCalledExactlyOnceWith('same','kuwo')
  expect(search.state.searching).toBe(false)
 })
})
