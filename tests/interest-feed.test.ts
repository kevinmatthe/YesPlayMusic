import { describe, expect, it, vi } from 'vitest'
import { createInterestFeed, recommendationNote } from '../src/interest-feed'
import type { Recommendations, Track } from '../src/core'
const track=(id:string):Track=>({id,source:id.split(':')[0]!,externalID:id.split(':')[1]!,title:'模拟歌曲',artist:'模拟歌手',album:'',picture:'',durationMs:120000})
const item=(id:string)=>({track:track(id),reason:'因为你喜欢模拟歌手',basis:'likes' as const})
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(){
 const api={recommendations:vi.fn(async():Promise<Recommendations>=>({tracks:[item('netease:1')],personalized:true})),searchHistory:vi.fn(async()=>({searches:[{query:'模拟搜索',source:'netease',count:1,lastSearchedAt:'2030-01-01T00:00:00Z'}]})),recordSearch:vi.fn(async()=>{}),clearSearchHistory:vi.fn(async()=>{})}
 const fallback=vi.fn(async()=>[track('kuwo:1')]);const feed=createInterestFeed(api,fallback);feed.setOwner('owner-a');return {api,fallback,feed}
}
describe('own-session recommendations and explicit search memory',()=>{
 it('loads reasons and stable IDs without sending a client owner identifier',async()=>{
  const {api,feed}=setup();await feed.loadRecommendations();await feed.loadSearches()
  expect(api.recommendations).toHaveBeenCalledExactlyOnceWith(12)
  expect(api.searchHistory).toHaveBeenCalledExactlyOnceWith(20)
  expect(feed.state.items[0]?.track.id).toBe('netease:1');expect(feed.state.personalized).toBe(true)
  expect(recommendationNote(feed.state.items[0]!)).toContain('喜欢')
 })
 it('clears all personal state immediately when actual session owner changes',async()=>{
  const {feed}=setup();await feed.loadRecommendations();await feed.loadSearches();feed.setOwner('owner-b')
  expect(feed.state.items).toEqual([]);expect(feed.state.searches).toEqual([]);expect(feed.state.personalized).toBe(false)
 })
 it('ignores late recommendations and failures from another owner',async()=>{
  const {api,feed}=setup(),late=deferred<Recommendations>()
  api.recommendations.mockImplementationOnce(()=>late.promise)
  const old=feed.loadRecommendations();feed.setOwner('owner-b');await feed.loadRecommendations()
  late.reject(new Error('old private request'));await old
  expect(feed.state.items.map(v=>v.track.id)).toEqual(['netease:1']);expect(feed.state.error).toBe('')
 })
 it('keeps the newest refresh when an older response arrives last',async()=>{
  const {api,feed}=setup(),late=deferred<Recommendations>()
  api.recommendations.mockImplementationOnce(()=>late.promise)
  const old=feed.loadRecommendations();await feed.loadRecommendations();late.resolve({tracks:[item('netease:old')],personalized:true});await old
  expect(feed.state.items.map(v=>v.track.id)).toEqual(['netease:1'])
 })
 it.each(['empty','error'])('uses public discovery fallback for %s recommendations without recording search',async mode=>{
  const {api,feed,fallback}=setup()
  if(mode==='empty')api.recommendations.mockResolvedValue({tracks:[],personalized:false})
  else api.recommendations.mockRejectedValue(new Error('offline'))
  await feed.loadRecommendations()
  expect(fallback).toHaveBeenCalledTimes(1);expect(feed.state.items[0]).toMatchObject({track:{id:'kuwo:1'},basis:'discovery'})
  expect(feed.state.personalized).toBe(false);expect(api.recordSearch).not.toHaveBeenCalled()
 })
 it('does not let an old history GET repopulate a cleared list',async()=>{
  const {api,feed}=setup(),late=deferred<{searches:{query:string,source:string,count:number,lastSearchedAt:string}[]}>()
  api.searchHistory.mockImplementationOnce(()=>late.promise)
  const old=feed.loadSearches();await feed.clearSearches();late.resolve({searches:[{query:'old private term',source:'netease',count:1,lastSearchedAt:''}]});await old
  expect(feed.state.searches).toEqual([])
 })
 it('serializes clear after an in-flight explicit record and never reloads its old result',async()=>{
  const {api,feed}=setup(),saving=deferred<void>();api.recordSearch.mockImplementationOnce(()=>saving.promise)
  const record=feed.recordSearch('  模拟主动搜索  ','kuwo');await Promise.resolve();await Promise.resolve()
  const clear=feed.clearSearches();expect(api.clearSearchHistory).not.toHaveBeenCalled()
  saving.resolve();await Promise.all([record,clear])
  expect(api.recordSearch).toHaveBeenCalledExactlyOnceWith('模拟主动搜索','kuwo')
  expect(api.clearSearchHistory).toHaveBeenCalledTimes(1);expect(feed.state.searches).toEqual([]);expect(api.searchHistory).not.toHaveBeenCalled()
 })
 it('cancels queued old-owner writes rather than sending them under the next session',async()=>{
  const {api,feed}=setup(),saving=deferred<void>();api.recordSearch.mockImplementationOnce(()=>saving.promise)
  const first=feed.recordSearch('first','netease');await Promise.resolve();await Promise.resolve()
  const queued=feed.recordSearch('must-not-migrate','netease');feed.setOwner('owner-b');saving.resolve();await Promise.all([first,queued])
  expect(api.recordSearch).toHaveBeenCalledTimes(1);expect(feed.state.searches).toEqual([])
 })
})
