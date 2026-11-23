import type { MusicApi, Playlist, Track } from './core/types'

export const PLAYLIST_LIMIT=1000
// The API validates canonical IDs as source:externalID. Titles are never identities.
export function uniqueTracks(tracks:Track[]):Track[]{return [...new Map(tracks.map(t=>[t.id,t])).values()]}
export function reconcileSelection(ids:string[],tracks:Track[]):string[]{
 const present=new Set(tracks.map(t=>t.id));return ids.filter(id=>present.has(id))
}
export interface PlaylistBatchResult {
 succeeded:Track[];skipped:Track[];failed:Track[];playlist?:Playlist;error?:string
}
type BatchApi=Pick<MusicApi,'listPlaylists'|'getPlaylist'|'updatePlaylist'|'addPlaylistTracks'>
const message=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
const capacityMessage='歌单最多 1000 首，请腾出位置后重试未加入的歌曲。'

async function addOnServer(api:BatchApi,targetID:string,requested:Track[]):Promise<PlaylistBatchResult>{
 try{
  const result=await api.addPlaylistTracks(targetID,requested.map(t=>t.id))
  const byID=new Map(requested.map(t=>[t.id,t]))
  const tracks=(ids:string[])=>ids.flatMap(id=>byID.get(id)||[])
  return {succeeded:tracks(result.addedIDs),skipped:tracks(result.existingIDs),failed:tracks(result.overflowIDs),
   playlist:result.playlist,error:result.overflowIDs.length?capacityMessage:undefined}
 }catch(e){
  // A lost response can hide a committed mutation. Read back current
  // membership without claiming that this request added the confirmed tracks.
  try{
   const playlist=await api.getPlaylist(targetID)
   const present=new Set(playlist.tracks.map(t=>t.id))
   const skipped=requested.filter(t=>present.has(t.id))
   const failed=requested.filter(t=>!present.has(t.id))
   return {succeeded:[],skipped,failed,playlist,error:failed.length?message(e):undefined}
  }catch{
   return {succeeded:[],skipped:[],failed:requested,error:message(e)}
  }
 }
}

/** One atomic revision-checked write. Retries always rebase the requested IDs on a fresh list. */
export async function editPlaylistBatch(api:BatchApi,targetID:string,input:Track[],action:'add'|'remove',serverAdds=false):Promise<PlaylistBatchResult>{
 const requested=uniqueTracks(input)
 if(action==='add'&&serverAdds&&requested.length)return addOnServer(api,targetID,requested)
 let target:Playlist|undefined
 try{target=(await api.listPlaylists()).find(p=>p.id===targetID)}
 catch(e){return {succeeded:[],skipped:[],failed:requested,error:message(e)}}
 if(!target)return {succeeded:[],skipped:[],failed:requested,error:'歌单已删除或当前空间无权访问，请刷新列表。'}
 if(target.kind==='sync')return {succeeded:[],skipped:[],failed:requested,error:'同步歌单的曲目由网易云更新。'}
 const existing=new Set(target.tracks.map(t=>t.id))
 const skipped=requested.filter(t=>action==='add'?existing.has(t.id):!existing.has(t.id))
 const candidates=requested.filter(t=>!skipped.includes(t))
 const room=action==='add'?Math.max(0,PLAYLIST_LIMIT-target.tracks.length):candidates.length
 const pending=candidates.slice(0,room),overflow=candidates.slice(room)
 const capacityError=overflow.length?capacityMessage:undefined
 if(!pending.length)return {succeeded:[],skipped,failed:overflow,playlist:target,error:capacityError}
 const removing=new Set(pending.map(t=>t.id))
 const ids=action==='add'?[...pending.map(t=>t.id),...target.tracks.map(t=>t.id)]:target.tracks.filter(t=>!removing.has(t.id)).map(t=>t.id)
 try{
  const playlist=await api.updatePlaylist(target,ids)
  return {succeeded:pending,skipped,failed:overflow,playlist,error:capacityError}
 }catch(e){
  // A response can be lost after commit. Verify state before reporting or retrying.
  try{
   const playlist=(await api.listPlaylists()).find(p=>p.id===targetID)
   if(!playlist)return {succeeded:[],skipped,failed:[...pending,...overflow],error:message(e)}
   const current=new Set(playlist.tracks.map(t=>t.id))
   const succeeded=pending.filter(t=>action==='add'?current.has(t.id):!current.has(t.id))
   const failed=[...pending.filter(t=>!succeeded.includes(t)),...overflow]
   return {succeeded,skipped,failed,playlist,error:failed.length?(capacityError||message(e)):undefined}
  }catch{
   return {succeeded:[],skipped,failed:[...pending,...overflow],error:'无法确认保存结果，请恢复网络后重试；会先读取最新歌单，避免重复加入。'}
  }
 }
}
