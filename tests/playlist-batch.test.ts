import { describe, expect, it, vi } from 'vitest'
import { editPlaylistBatch, reconcileSelection, uniqueTracks } from '../src/playlist-batch'
import type { MusicApi, Playlist, Track } from '../src/core/types'

const track=(id:string):Track=>({id,source:id.split(':')[0]!,externalID:id.split(':')[1]!,title:id,artist:'',album:'',picture:'',durationMs:10000})
const a=track('netease:1'),b=track('kuwo:1'),c=track('netease:3')
function setup(ids:string[]=[a.id]){
 let playlist:Playlist={id:'target',name:'目标',revision:1,tracks:ids.map(track)}
 const listPlaylists=vi.fn(async()=>[playlist])
 const updatePlaylist=vi.fn(async(p:Playlist,trackIDs:string[])=>{
  expect(p.revision).toBe(playlist.revision)
  playlist={...p,revision:p.revision+1,tracks:trackIDs.map(track)};return playlist
 })
 return {api:{listPlaylists,updatePlaylist} as unknown as MusicApi,listPlaylists,updatePlaylist,get current(){return playlist},set current(p:Playlist){playlist=p}}
}
describe('playlist batch identities and atomic writes',()=>{
 it('keeps different sources separate and intersects selection after updates',()=>{
  expect(uniqueTracks([a,b,a])).toEqual([a,b])
  expect(reconcileSelection([a.id,b.id,c.id],[b,a])).toEqual([a.id,b.id])
 })
 it('adds in selected order, skips existing songs and uses the newest revision',async()=>{
  const s=setup();s.current={...s.current,revision:7,tracks:[c,a]}
  const r=await editPlaylistBatch(s.api,'target',[a,b],'add')
  expect(s.current.tracks.map(t=>t.id)).toEqual([b.id,c.id,a.id])
  expect(r.succeeded).toEqual([b]);expect(r.skipped).toEqual([a]);expect(r.failed).toEqual([])
  expect(s.updatePlaylist).toHaveBeenCalledTimes(1)
 })
 it('sends all requested IDs to the server add operation and uses its returned order',async()=>{
  const s=setup()
  const putPlaylistTracks=vi.fn(async()=>({
   playlist:{...s.current,revision:2,tracks:[c,b,a]},
   addedIDs:[c.id,b.id],existingIDs:[a.id],overflowIDs:[],
  }))
  const r=await editPlaylistBatch({...s.api,addPlaylistTracks:putPlaylistTracks},'target',[c,a,b,c],'add',true)
  expect(putPlaylistTracks).toHaveBeenCalledWith('target',[c.id,a.id,b.id])
  expect(s.updatePlaylist).not.toHaveBeenCalled()
  expect(r.playlist?.tracks).toEqual([c,b,a])
  expect(r.succeeded).toEqual([c,b])
  expect(r.skipped).toEqual([a])
 })
 it('refreshes the cache when the new add response is lost after commit',async()=>{
  const s=setup()
  const current={...s.current,revision:2,tracks:[b,a]}
  const api={...s.api,addPlaylistTracks:vi.fn(async()=>{throw new Error('断开连接')}),getPlaylist:vi.fn(async()=>current)}
  const r=await editPlaylistBatch(api,'target',[a,b],'add',true)
  expect(r.playlist).toBe(current)
  expect(r.failed).toEqual([])
  expect(r.skipped).toEqual([a,b])
  expect(s.updatePlaylist).not.toHaveBeenCalled()
 })
 it('reports partial capacity without losing accepted items on retry',async()=>{
  const s=setup(Array.from({length:999},(_,i)=>`netease:${i+100}`))
  const r=await editPlaylistBatch(s.api,'target',[a,b,c],'add')
  expect(r.succeeded).toEqual([a]);expect(r.failed).toEqual([b,c]);expect(s.current.tracks).toHaveLength(1000)
  const retry=await editPlaylistBatch(s.api,'target',r.failed,'add')
  expect(retry.failed).toEqual([b,c]);expect(s.updatePlaylist).toHaveBeenCalledTimes(1)
 })
 it('removes only requested IDs from the one target and preserves source siblings',async()=>{
  const s=setup([a.id,b.id,c.id]);const r=await editPlaylistBatch(s.api,'target',[a],'remove')
  expect(s.current.tracks.map(t=>t.id)).toEqual([b.id,c.id]);expect(r.succeeded).toEqual([a])
  expect(s.updatePlaylist.mock.calls[0]![0].id).toBe('target')
 })
 it('reads back a lost success response so retry does not append duplicates',async()=>{
  const s=setup();s.updatePlaylist.mockImplementationOnce(async(p,ids)=>{s.current={...p,revision:2,tracks:ids.map(track)};throw new Error('连接断开')})
  const r=await editPlaylistBatch(s.api,'target',[b],'add')
  expect(r.succeeded).toEqual([b]);expect(r.failed).toEqual([]);expect(r.playlist?.revision).toBe(2)
 })
 it('does not automatically overwrite a revision conflict and retains failed songs',async()=>{
  const s=setup();s.updatePlaylist.mockImplementationOnce(async()=>{s.current={...s.current,revision:2,tracks:[a,c]};throw new Error('内容已在其他窗口更新')})
  const r=await editPlaylistBatch(s.api,'target',[b],'add')
  expect(r.failed).toEqual([b]);expect(r.error).toContain('其他窗口');expect(s.updatePlaylist).toHaveBeenCalledTimes(1)
  const retry=await editPlaylistBatch(s.api,'target',r.failed,'add')
  expect(retry.failed).toEqual([]);expect(s.current.tracks.map(t=>t.id)).toEqual([b.id,a.id,c.id])
 })
 it('does not count an unconfirmed write as success when readback also fails',async()=>{
  const s=setup();s.updatePlaylist.mockRejectedValue(new Error('断网'));s.listPlaylists.mockResolvedValueOnce([s.current]).mockRejectedValueOnce(new Error('断网'))
  const r=await editPlaylistBatch(s.api,'target',[b],'add')
  expect(r.succeeded).toEqual([]);expect(r.failed).toEqual([b]);expect(r.error).toContain('无法确认')
 })
 it('handles missing playlist, read failure and a no-op without mutation',async()=>{
  const s=setup();const missing=await editPlaylistBatch(s.api,'missing',[a],'remove')
  expect(missing.failed).toEqual([a]);expect(s.updatePlaylist).not.toHaveBeenCalled()
  s.listPlaylists.mockRejectedValueOnce(new Error('会话已过期'))
  expect((await editPlaylistBatch(s.api,'target',[a],'remove')).error).toContain('会话')
  expect((await editPlaylistBatch(s.api,'target',[a],'add')).skipped).toEqual([a]);expect(s.updatePlaylist).not.toHaveBeenCalled()
 })
})
