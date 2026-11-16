import type { MusicApi, Track } from './core/types'
import { uniqueTracks } from './playlist-batch'

export interface BatchLikeResult {
 succeeded:Track[];skipped:Track[];failed:Track[];likes?:Track[];error?:string;unconfirmed:boolean
}
export async function markTracksLiked(
 api:Pick<MusicApi,'likes'|'setLike'>,
 input:Track[],
 onConfirmed?:(track:Track)=>void,
):Promise<BatchLikeResult>{
 const requested=uniqueTracks(input)
 if(!requested.length)return {succeeded:[],skipped:[],failed:[],unconfirmed:false}
 let initial:Track[]
 try{initial=await api.likes()}
 catch(error){
  const expired=(error as {status?:number}|null)?.status===401
  return {succeeded:[],skipped:[],failed:requested,unconfirmed:false,error:expired?'当前会话已过期，无法读取喜欢列表，本次未修改任何歌曲，请重新登录后重试。':'无法读取喜欢列表，本次未修改任何歌曲，请稍后重试。'}
 }
 const existing=new Set(initial.map(t=>t.id))
 const pending=requested.filter(t=>!existing.has(t.id))
 const confirmed=new Set<string>()
 const notify=(t:Track)=>{
  if(confirmed.has(t.id))return
  confirmed.add(t.id)
  // UI observer errors cannot undo an acknowledged server update.
  try{onConfirmed?.(t)}catch{}
 }
 let next=0,expired=false
 const worker=async()=>{
  while(!expired&&next<pending.length){
   const t=pending[next++]!
   try{await api.setLike(t.id,true)}
   catch(error){
    if((error as {status?:number}|null)?.status===401)expired=true
    continue
   }
   notify(t)
  }
 }
 await Promise.all(Array.from({length:Math.min(3,pending.length)},worker))
 let likes:Track[]
 try{likes=await api.likes()}
 catch{
  const succeeded=pending.filter(t=>confirmed.has(t.id))
  const skipped=requested.filter(t=>existing.has(t.id))
  const failed=pending.filter(t=>!confirmed.has(t.id))
  return {succeeded,skipped,failed,unconfirmed:true,error:`${expired?'当前会话已过期。':''}无法读取最新喜欢列表，其余结果未确认。已保留确认成功和原已喜欢的歌曲，请稍后重试未确认项；重试会先读取最新列表。`}
 }
 const current=new Set(likes.map(t=>t.id))
 const succeeded=pending.filter(t=>current.has(t.id))
 const skipped=requested.filter(t=>existing.has(t.id)&&current.has(t.id))
 const failed=requested.filter(t=>!current.has(t.id))
 // A lost response is also confirmed if the latest server list contains it.
 succeeded.forEach(notify)
 return {succeeded,skipped,failed,likes,unconfirmed:false,...(failed.length?{error:expired?'当前会话已过期，请重新登录后重试未成功的歌曲。':'部分歌曲未能标记喜欢，请重试失败项。'}:{})}
}
