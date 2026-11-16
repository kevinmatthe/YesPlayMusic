import { describe, expect, it, vi } from 'vitest'
import type { MusicApi, Track } from '../src/core/types'
import { markTracksLiked } from '../src/batch-like'

const track=(id:string):Track=>({id,source:id.split(':')[0]!,externalID:id.split(':')[1]!,title:id,artist:'',album:'',picture:'',durationMs:10000})
const a=track('netease:1'),b=track('kuwo:1'),c=track('netease:3'),d=track('netease:4'),e=track('netease:5')
const deferred=<T>()=>{
 let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no})
 return {promise,resolve,reject}
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
function setup(initial:Track[]=[]){
 const liked=new Map(initial.map(t=>[t.id,t]))
 const api={
  likes:vi.fn<MusicApi['likes']>(async()=>[...liked.values()]),
  setLike:vi.fn<MusicApi['setLike']>(async(id,like)=>{expect(like).toBe(true);liked.set(id,track(id))}),
  resolve:vi.fn(),saveQueue:vi.fn(),updatePlaylist:vi.fn(),
 }
 return {api,liked}
}

describe('mark selected tracks liked',()=>{
 it('does no IO for an empty selection',async()=>{
  const {api}=setup(),confirmed=vi.fn()
  expect(await markTracksLiked(api,[],confirmed)).toEqual({succeeded:[],skipped:[],failed:[],unconfirmed:false})
  expect(api.likes).not.toHaveBeenCalled();expect(api.setLike).not.toHaveBeenCalled();expect(confirmed).not.toHaveBeenCalled()
 })
 it('deduplicates full identities, keeps equal external IDs in different sources, and only sets true',async()=>{
  const {api}=setup()
  const result=await markTracksLiked(api,[a,b,a,b,c])
  expect(result.succeeded).toEqual([a,b,c]);expect(result.skipped).toEqual([]);expect(result.failed).toEqual([])
  expect(api.setLike.mock.calls).toEqual([[a.id,true],[b.id,true],[c.id,true]])
  expect(result.likes?.map(t=>t.id)).toEqual([a.id,b.id,c.id]);expect(result.unconfirmed).toBe(false)
  expect(api.likes).toHaveBeenCalledTimes(2)
  expect(api.resolve).not.toHaveBeenCalled();expect(api.saveQueue).not.toHaveBeenCalled();expect(api.updatePlaylist).not.toHaveBeenCalled()
 })
 it('skips freshly liked items and returns the entire latest list including unrelated likes',async()=>{
  const {api,liked}=setup([a,d])
  api.setLike.mockImplementation(async(id)=>{liked.set(id,track(id));liked.set(e.id,e)})
  const result=await markTracksLiked(api,[a,b,c])
  expect(result.skipped).toEqual([a]);expect(result.succeeded).toEqual([b,c]);expect(result.failed).toEqual([])
  expect(api.setLike.mock.calls).toEqual([[b.id,true],[c.id,true]])
  expect(result.likes?.map(t=>t.id)).toEqual([a.id,d.id,b.id,e.id,c.id])
 })
 it('does not write when all requested tracks are already liked',async()=>{
  const {api}=setup([a,b])
  const result=await markTracksLiked(api,[a,a,b])
  expect(result.skipped).toEqual([a,b]);expect(result.succeeded).toEqual([]);expect(result.failed).toEqual([])
  expect(api.setLike).not.toHaveBeenCalled();expect(api.likes).toHaveBeenCalledTimes(2)
  expect(result.likes).toEqual([a,b]);expect(result.unconfirmed).toBe(false)
 })
 it('submits nothing after the initial read fails and clearly reports no modification',async()=>{
  const {api}=setup();api.likes.mockRejectedValue(new Error('断网'))
  const result=await markTracksLiked(api,[a,b,a])
  expect(result.failed).toEqual([a,b]);expect(result.succeeded).toEqual([]);expect(result.skipped).toEqual([])
  expect(result.error).toContain('未修改');expect(result.likes).toBeUndefined();expect(result.unconfirmed).toBe(false)
  expect(api.likes).toHaveBeenCalledTimes(1);expect(api.setLike).not.toHaveBeenCalled()
 })
 it('retains only failed tracks after a partial 500 and retries without repeating or cancelling successes',async()=>{
  const {api,liked}=setup([a])
  api.setLike.mockImplementationOnce(async()=>{throw Object.assign(new Error('服务错误'),{status:500})})
  const first=await markTracksLiked(api,[a,b,c])
  expect(first.succeeded).toEqual([c]);expect(first.skipped).toEqual([a]);expect(first.failed).toEqual([b]);expect(first.error).toContain('重试')
  expect([...liked.keys()]).toEqual([a.id,c.id])
  const retry=await markTracksLiked(api,[a,b,c])
  expect(retry.succeeded).toEqual([b]);expect(retry.skipped).toEqual([a,c]);expect(retry.failed).toEqual([])
  expect(api.setLike.mock.calls).toEqual([[b.id,true],[c.id,true],[b.id,true]])
  expect([...liked.keys()]).toEqual([a.id,c.id,b.id])
 })
 it('stops dispatching on 401 while letting the other already-started writes finish',async()=>{
  const {api,liked}=setup(),unauthorized=deferred<void>(),second=deferred<void>(),third=deferred<void>()
  const gates=new Map([[a.id,unauthorized],[b.id,second],[c.id,third]])
  api.setLike.mockImplementation(async(id)=>{await gates.get(id)!.promise;liked.set(id,track(id))})
  const pending=markTracksLiked(api,[a,b,c,d,e]);await flush()
  expect(api.setLike.mock.calls.map(call=>call[0])).toEqual([a.id,b.id,c.id])
  unauthorized.reject(Object.assign(new Error('会话过期'),{status:401}));await flush()
  second.resolve();third.resolve()
  const result=await pending
  expect(api.setLike).toHaveBeenCalledTimes(3)
  expect(result.succeeded).toEqual([b,c]);expect(result.failed).toEqual([a,d,e]);expect(result.error).toContain('会话')
  expect(result.unconfirmed).toBe(false);expect(result.likes?.map(t=>t.id)).toEqual([b.id,c.id])
 })
 it('counts a committed write with a lost response as confirmed success from readback',async()=>{
  const {api,liked}=setup(),confirmed=vi.fn()
  api.setLike.mockImplementationOnce(async(id)=>{liked.set(id,track(id));throw new Error('响应丢失')})
  const result=await markTracksLiked(api,[a],confirmed)
  expect(result.succeeded).toEqual([a]);expect(result.failed).toEqual([]);expect(result.error).toBeUndefined()
  expect(result.unconfirmed).toBe(false);expect(confirmed).toHaveBeenCalledExactlyOnceWith(a)
  const retry=await markTracksLiked(api,[a],confirmed)
  expect(retry.skipped).toEqual([a]);expect(api.setLike).toHaveBeenCalledTimes(1);expect(confirmed).toHaveBeenCalledTimes(1)
 })
 it('keeps acknowledged successes and initial skips without replacing UI likes when final readback fails',async()=>{
  const {api}=setup([a]),confirmed=vi.fn()
  api.likes.mockResolvedValueOnce([a]).mockRejectedValueOnce(new Error('读回断网'))
  api.setLike.mockImplementationOnce(async()=>{}).mockRejectedValueOnce(new Error('提交断网'))
  const result=await markTracksLiked(api,[a,b,c],confirmed)
  expect(result.succeeded).toEqual([b]);expect(result.skipped).toEqual([a]);expect(result.failed).toEqual([c])
  expect(result.unconfirmed).toBe(true);expect(result.likes).toBeUndefined();expect(result.error).toContain('未确认')
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(b)
 })
 it('describes uncertainty rather than success when both all writes and final readback fail',async()=>{
  const {api}=setup()
  api.likes.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('读回断网'))
  api.setLike.mockRejectedValue(Object.assign(new Error('服务错误'),{status:500}))
  const result=await markTracksLiked(api,[a,b])
  expect(result.succeeded).toEqual([]);expect(result.failed).toEqual([a,b]);expect(result.skipped).toEqual([])
  expect(result.unconfirmed).toBe(true);expect(result.likes).toBeUndefined();expect(result.error).toContain('未确认')
 })
 it('uses final readback truth if a confirmed or initially liked item is concurrently unliked',async()=>{
  const {api,liked}=setup([a]),confirmed=vi.fn()
  api.setLike.mockImplementation(async()=>{liked.delete(a.id)})
  const result=await markTracksLiked(api,[a,b],confirmed)
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(b)
  expect(result.succeeded).toEqual([]);expect(result.skipped).toEqual([]);expect(result.failed).toEqual([a,b])
  expect(result.likes).toEqual([]);expect(result.unconfirmed).toBe(false)
 })
 it('never runs more than three writes and confirms each success before the whole batch completes',async()=>{
  const {api,liked}=setup(),tracks=[a,b,c,d,e],gates=new Map(tracks.map(t=>[t.id,deferred<void>()]))
  const confirmed=vi.fn();let active=0,peak=0,finished=false
  api.setLike.mockImplementation(async(id)=>{active++;peak=Math.max(peak,active);await gates.get(id)!.promise;liked.set(id,track(id));active--})
  const pending=markTracksLiked(api,tracks,confirmed).then(result=>{finished=true;return result})
  await flush();expect(api.setLike).toHaveBeenCalledTimes(3);expect(active).toBe(3)
  gates.get(b.id)!.resolve();await flush()
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(b);expect(finished).toBe(false)
  expect(api.setLike).toHaveBeenCalledTimes(4);expect(active).toBe(3)
  gates.get(a.id)!.resolve();await flush();expect(api.setLike).toHaveBeenCalledTimes(5)
  gates.get(c.id)!.resolve();gates.get(d.id)!.resolve();gates.get(e.id)!.resolve()
  const result=await pending
  expect(peak).toBe(3);expect(result.succeeded).toEqual(tracks);expect(result.failed).toEqual([])
  expect(confirmed.mock.calls.map(call=>call[0].id)).toEqual([b.id,a.id,c.id,d.id,e.id])
 })
 it('does not reinterpret an acknowledged write as failed if the UI callback throws',async()=>{
  const {api}=setup()
  const result=await markTracksLiked(api,[a,b],()=>{throw new Error('界面回调失败')})
  expect(result.succeeded).toEqual([a,b]);expect(result.failed).toEqual([]);expect(result.unconfirmed).toBe(false)
  expect(api.setLike).toHaveBeenCalledTimes(2)
 })
})
