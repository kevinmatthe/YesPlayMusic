import { describe, expect, it, vi } from 'vitest'
import { normalizeAssociation, associationAttribution } from '../src/recommendation-association'
import { createMusicApi } from '../src/core/api'
import { createInterestFeed } from '../src/interest-feed'

const association={kind:'similar_song',source:'lastfm',seedTrackID:'netease:1',sourceURL:'https://www.last.fm/music/Cher/_/Believe',match:95.48}
const track={id:'netease:2',source:'netease',externalID:'2',title:'合成关联歌曲',artist:'合成歌手',album:'',picture:'',durationMs:12000}
describe('optional recommendation associations',()=>{
 it('retains raw finite match as metadata without presenting a percentage or a style claim',()=>{
  const value=normalizeAssociation(association)
  expect(value).toEqual(association)
  expect(associationAttribution(value)).toEqual({label:'Last.fm',url:association.sourceURL,note:'歌曲关联，供发现参考'})
  expect(JSON.stringify(associationAttribution(value))).not.toMatch(/95|%|同风格/)
 })
 it.each([
  'javascript:alert(1)','http://www.last.fm/music/Cher','https://www.last.fm.evil.test/music/Cher',
  'https://user:password@www.last.fm/music/Cher','https://www.last.fm:8443/music/Cher',
  'https://www.last.fm/music/Cher?api_key=private','https://www.last.fm/music/Cher#secret',
  'https://www.last.fm/api/auth','https://www.last.fm/music/','https://ws.audioscrobbler.com/2.0/',
  'https://www.last.fm/music/Cher/%3Fapi_key%3Dprivate','https://www.last.fm/music/Cher/../api',
 ])('does not expose untrusted or credential-bearing source URL %s',sourceURL=>{
  const value=normalizeAssociation({...association,sourceURL})
  expect(value?.sourceURL).toBeUndefined()
  expect(associationAttribution(value)).toEqual({label:'Last.fm',note:'歌曲关联，供发现参考'})
 })
 it('accepts bare public Last.fm host and Chinese public music paths',()=>{
  expect(normalizeAssociation({...association,sourceURL:'https://last.fm/music/陳綺貞/_/旅行的意義'})?.sourceURL).toBeTruthy()
 })
 it('limits Netease attribution to the public song page, and rejects source mismatch',()=>{
  const value=normalizeAssociation({...association,source:'netease',sourceURL:'https://music.163.com/#/song?id=123'})
  expect(associationAttribution(value)).toEqual({label:'网易云音乐',url:'https://music.163.com/#/song?id=123',note:'歌曲关联，供发现参考'})
  expect(normalizeAssociation({...association,sourceURL:'https://music.163.com/#/song?id=123'})?.sourceURL).toBeUndefined()
  expect(normalizeAssociation({...association,source:'netease',sourceURL:'https://music.163.com/#/song?id=123&token=secret'})?.sourceURL).toBeUndefined()
 })
 it.each([undefined,null,{},'bad',{...association,source:'unverified'},{...association,kind:'same_style'},{...association,seedTrackID:undefined}])('omits absent or unsupported metadata without breaking tracks',value=>{
  expect(normalizeAssociation(value)).toBeUndefined()
  expect(associationAttribution(normalizeAssociation(value))).toBeUndefined()
 })
 it('drops non-finite match and unknown fields instead of leaking server diagnostics',()=>{
  expect(normalizeAssociation({...association,match:Infinity,api_key:'private'})).toEqual({kind:'similar_song',source:'lastfm',seedTrackID:'netease:1',sourceURL:association.sourceURL})
 })
 it('preserves metadata through real API and feed, supports legacy results, and keeps source on failed refresh',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({tracks:[{track,basis:'likes',reason:'关联候选',association}],personalized:true})))
   .mockResolvedValueOnce(new Response(JSON.stringify({error:'unavailable'}),{status:503}))
   .mockResolvedValueOnce(new Response(JSON.stringify({tracks:[{track,basis:'discovery',reason:'公开曲库'}],personalized:false})))
  const api=createMusicApi(fetcher),feed=createInterestFeed(api);feed.setOwner('synthetic-owner')
  await feed.loadRecommendations();expect(feed.state.items[0]?.association).toEqual(association)
  await feed.loadRecommendations({refresh:true});expect(feed.state.error).toContain('保留');expect(feed.state.items[0]?.association).toEqual(association)
  await feed.loadRecommendations({refresh:true});expect(feed.state.items[0]?.association).toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(3)
 })
})
