import {describe,it,expect,vi} from 'vitest'
import {createSourceSearch} from '../src/source-search'
import {createInterestFeed} from '../src/interest-feed'
import type {Track,Recommendations,SearchRecord} from '../src/core'
const t=(id:string):Track=>({id,source:'netease',externalID:id,title:id,artist:'Test',album:'',picture:'',durationMs:60000})
const result=(id:string):Recommendations=>({tracks:[{track:t(id),reason:'',basis:'likes'}],personalized:true})
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
const api=()=>({recommendations:vi.fn(async()=>result('old')),searchHistory:vi.fn(async()=>({searches:[] as SearchRecord[]})),recordSearch:vi.fn(async()=>{}),clearSearchHistory:vi.fn(async()=>{})})
describe('metadata response lifecycle',()=>{
 it('coalesces repeated identical search submits and records only once after success',async()=>{
  const pending=deferred<Track[]>(),search=vi.fn(()=>pending.promise),record=vi.fn(),s=createSourceSearch({search},record)
  const a=s.run('query',true),b=s.run('query',true);expect(search).toHaveBeenCalledTimes(1);expect(record).not.toHaveBeenCalled();pending.resolve([t('one')]);await Promise.all([a,b]);expect(record).toHaveBeenCalledTimes(1)
 })
 it('invalidates an in-flight search when the draft changes before another submit',async()=>{
  const pending=deferred<Track[]>(),s=createSourceSearch({search:()=>pending.promise})
  const a=s.run('old');s.edit('new');pending.resolve([t('old')]);await a;expect(s.state.results).toEqual([]);expect(s.state.searching).toBe(false)
 })
 it('keeps usable results and offers a local failure status',async()=>{
  const search=vi.fn().mockResolvedValueOnce([t('usable')]).mockRejectedValueOnce(new Error('offline')),s=createSourceSearch({search})
  await s.run('good');await s.run('bad');expect(s.state.results.map(t=>t.id)).toEqual(['usable']);expect(s.state.error).toContain('重试');expect(s.state.resultQuery).toBe('good')
 })
 it('prevents disposed search results or history writes from committing',async()=>{
  const pending=deferred<Track[]>(),record=vi.fn(),s=createSourceSearch({search:()=>pending.promise},record)
  const a=s.run('query',true);s.dispose();pending.resolve([t('private')]);await a;expect(s.state.results).toEqual([]);expect(record).not.toHaveBeenCalled()
 })
 it('reuses recommendation content during navigation and coalesces an in-flight refresh',async()=>{
  const a=api(),pending=deferred<Recommendations>();a.recommendations.mockImplementationOnce(()=>pending.promise)
  const f=createInterestFeed(a);f.setOwner('test');const one=f.loadRecommendations(),two=f.loadRecommendations();expect(a.recommendations).toHaveBeenCalledTimes(1);pending.resolve(result('old'));await Promise.all([one,two]);await f.loadRecommendations();expect(a.recommendations).toHaveBeenCalledTimes(1)
 })
 it('preserves personal recommendations and reports a refresh outage without a public substitution',async()=>{
  const a=api(),fallback=vi.fn(async()=>[t('public')]),f=createInterestFeed(a,fallback);f.setOwner('test');await f.loadRecommendations();a.recommendations.mockRejectedValueOnce(new Error('offline'));await f.loadRecommendations({refresh:true});expect(f.state.items[0]?.track.id).toBe('old');expect(f.state.personalized).toBe(true);expect(f.state.error).toContain('重试');expect(fallback).not.toHaveBeenCalled()
 })
 it('does not repopulate deleted searches from a read started while deletion is pending',async()=>{
  const a=api(),deletion=deferred<void>(),read=deferred<{searches:SearchRecord[]}>();a.clearSearchHistory.mockImplementationOnce(()=>deletion.promise);a.searchHistory.mockImplementationOnce(()=>read.promise)
  const f=createInterestFeed(a);f.setOwner('test');const clear=f.clearSearches();await Promise.resolve();await Promise.resolve();const loading=f.loadSearches();deletion.resolve();await clear;read.resolve({searches:[{query:'deleted',source:'netease',count:1,lastSearchedAt:''}]});await loading;expect(f.state.searches).toEqual([])
 })
 it('clears memory on identity change even when a request ignores cancellation',async()=>{
  const a=api(),pending=deferred<Recommendations>();a.recommendations.mockImplementationOnce(()=>pending.promise);const f=createInterestFeed(a);f.setOwner('a');const loading=f.loadRecommendations();f.setOwner('b');pending.resolve(result('private'));await loading;expect(f.state.items).toEqual([]);expect(f.state.loading).toBe(false)
 })
})

it.each(['record','clear'])('releases a hanging %s write with an honest unconfirmed status',async operation=>{
 vi.useFakeTimers();try{
  const a=api(),never=new Promise<void>(()=>{}),f=createInterestFeed(a);f.setOwner('test')
  if(operation==='record')a.recordSearch.mockReturnValueOnce(never);else a.clearSearchHistory.mockReturnValueOnce(never)
  const writing=operation==='record'?f.recordSearch('query','netease'):f.clearSearches()
  await vi.advanceTimersByTimeAsync(15001);await writing
  expect(f.state.historyLoading).toBe(false);expect(f.state.historyError).toContain('未能确认')
  await f.clearSearches();expect(f.state.historyError).toBe('');expect(f.state.searches).toEqual([])
 }finally{vi.useRealTimers()}
})
