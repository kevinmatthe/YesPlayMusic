import { describe, expect, it, vi } from 'vitest'
import { createMusicApi } from '../src/core/api'
describe('copy a public NetEase playlist into own library',()=>{
 it('uses only the own-session import endpoint and preserves the returned stable recording ID',async()=>{
  const result={playlist:{id:'new-own-list',name:'模拟导入歌单',revision:1,tracks:[{id:'netease:11',source:'netease',externalID:'11',title:'Same title (Live)',artist:'Artist',album:'Edition',durationMs:120000,picture:''}]},imported:1,duplicatesSkipped:2,sourcePlaylistID:'123456'}
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(result))),api=createMusicApi(fetcher)
  expect(await api.importNetEasePlaylist('123456','自己的新歌单')).toEqual(result)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/music-api/v1/imports/netease-playlist',expect.objectContaining({method:'POST',credentials:'same-origin',body:JSON.stringify({urlOrID:'123456',name:'自己的新歌单'})}))
 })
 it('does not request the source or any account API for an empty input',async()=>{
  const fetcher=vi.fn(),api=createMusicApi(fetcher)
  await expect(api.importNetEasePlaylist('  ')).rejects.toThrow('链接或数字')
  expect(fetcher).not.toHaveBeenCalled()
 })
 it.each([[413,'playlist_too_large','1000'],[403,'playlist_private_or_restricted','公开歌单']])('explains status %s without requesting personal music login',async(status,error,message)=>{
  const api=createMusicApi(vi.fn().mockResolvedValue(new Response(JSON.stringify({error}),{status:Number(status)})))
  await expect(api.importNetEasePlaylist('123')).rejects.toThrow(String(message))
 })
 it('does not claim success or automatically repeat a POST when the result is incomplete',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({imported:2}))),api=createMusicApi(fetcher)
  await expect(api.importNetEasePlaylist('123')).rejects.toThrow('刷新歌单确认')
  expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it.each([[400,'netease_playlist_full_url_required','完整'],[422,'public_playlist_metadata_incomplete','未创建'],[429,'provider_rate_limited','请求较多']])('explains source-specific failure %s %s',async(status,error,message)=>{
  const api=createMusicApi(vi.fn().mockResolvedValue(new Response(JSON.stringify({error}),{status:Number(status)})))
  await expect(api.importNetEasePlaylist('123')).rejects.toThrow(String(message))
 })
})
