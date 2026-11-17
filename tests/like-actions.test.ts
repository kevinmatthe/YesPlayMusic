import {describe,it,expect,vi} from 'vitest'
import {createLikeActions} from '../src/like-actions'
import type {MusicApi,Track} from '../src/core'
const track=(id:string):Track=>({id,source:'netease',externalID:id,title:id,artist:'Test',album:'',picture:'',durationMs:1})
const deferred=()=>{let resolve!:()=>void,reject!:(e:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(){let likes:Track[]=[];const api={setLike:vi.fn<MusicApi['setLike']>(async()=>{})},actions=createLikeActions(api,()=>likes,next=>likes=next);actions.setOwner('test');return {api,actions,likes:()=>likes}}
describe('confirmed per-track likes',()=>{
 it('shows saving immediately, merges duplicate clicks, and updates only after confirmation',async()=>{
  const s=setup(),pending=deferred();s.api.setLike.mockImplementationOnce(()=>pending.promise)
  const a=s.actions.toggle(track('a')),b=s.actions.toggle(track('a'));expect(s.actions.state.pending).toEqual(['a']);expect(s.likes()).toEqual([]);expect(s.api.setLike).toHaveBeenCalledTimes(1)
  pending.resolve();await Promise.all([a,b]);expect(s.likes().map(t=>t.id)).toEqual(['a']);expect(s.actions.state.pending).toEqual([])
 })
 it('merges concurrent confirmations for different songs without a stale full-list GET',async()=>{
  const s=setup(),a=deferred(),b=deferred();s.api.setLike.mockImplementationOnce(()=>a.promise).mockImplementationOnce(()=>b.promise)
  const one=s.actions.toggle(track('a')),two=s.actions.toggle(track('b'));b.resolve();await two;a.resolve();await one;expect(s.likes().map(t=>t.id)).toEqual(['b','a'])
 })
 it('retains confirmed state, reports failure and permits retry',async()=>{
  const s=setup();s.api.setLike.mockRejectedValueOnce(new Error('offline'));await s.actions.toggle(track('a'));expect(s.likes()).toEqual([]);expect(s.actions.state.errors.a).toContain('重试');await s.actions.toggle(track('a'));expect(s.likes().map(t=>t.id)).toEqual(['a']);expect(s.actions.state.errors.a).toBeUndefined()
 })
 it('cannot apply an old-owner response after a switch away and back',async()=>{
  const s=setup(),pending=deferred();s.api.setLike.mockImplementationOnce(()=>pending.promise);const one=s.actions.toggle(track('private'));s.actions.setOwner('b');s.actions.setOwner('test');pending.resolve();await one;expect(s.likes()).toEqual([]);expect(s.actions.state.pending).toEqual([])
 })
})

it('releases a timed-out save and retries the same unconfirmed intent',async()=>{
 vi.useFakeTimers();try{
  const s=setup(),pending=deferred();s.api.setLike.mockImplementationOnce(()=>pending.promise)
  const first=s.actions.toggle(track('a'));await vi.advanceTimersByTimeAsync(15001);await first
  expect(s.actions.state.pending).toEqual([]);expect(s.actions.state.errors.a).toContain('未能确认')
  await s.actions.toggle(track('a'));expect(s.api.setLike.mock.calls.map(c=>c[1])).toEqual([true,true]);expect(s.likes().map(t=>t.id)).toEqual(['a'])
 }finally{vi.useRealTimers()}
})
