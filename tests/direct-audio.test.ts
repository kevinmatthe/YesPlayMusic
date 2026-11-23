import { describe, it, expect, vi } from 'vitest';
import { createMusicApi } from '../src/core/api';
describe('web direct audio contract',()=>{
 it.each([
  [undefined,'https://music.kmhomelab.cn:2443/cloudmusic/music/42.mp3'],
  ['unknown','https://music.kmhomelab.cn:2443/cloudmusic/music/42.mp3'],
  [undefined,'https://m801.music.126.net/42.mp3'],
  ['unknown','https://m801.music.126.net/42.mp3'],
 ])('rejects missing or unknown status %s even with direct delivery and URL %s',async(status,url)=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({trackID:'netease:42',delivery:'direct',status,url,expiresAt:'2030-01-01T00:00:00Z'})));
  const result=await createMusicApi(fetcher).resolve('netease:42');
  expect(result.status).toBe('unavailable');
  expect(result.reason).toContain('直连音源');
  expect(result.url).toBeUndefined();
  expect(result.expiresAt).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['available','preview','unavailable'] as const)('preserves the valid status %s and its URL policy',async status=>{
  const url='https://m801.music.126.net/42.mp3';
  const result=await createMusicApi(vi.fn(async()=>new Response(JSON.stringify({trackID:'netease:42',delivery:'direct',status,url,expiresAt:'2030-01-01T00:00:00Z',reason:'external_source_unavailable'})))).resolve('netease:42');
  expect(result.status).toBe(status);
  expect(result.delivery).toBe('direct');
  expect(result.url).toBe(status==='unavailable'?undefined:url);
  expect(result.expiresAt).toBe(status==='unavailable'?undefined:'2030-01-01T00:00:00Z');
 });
 it('opts in on every resolution including retries and sends direct metadata headers',async()=>{
  const fetcher=vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({trackID:'netease:42',status:'available',delivery:'direct',url:'https://m801.music.126.net/song.mp3'})));
  const api=createMusicApi(fetcher);await api.resolve('netease:42');await api.resolve('netease:42');await api.lyrics('netease:42');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({body:JSON.stringify({delivery:'direct'}),headers:{'X-Music-Delivery':'direct'}});
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({body:JSON.stringify({delivery:'direct'})});
  expect(fetcher.mock.calls[2]?.[1]).toMatchObject({headers:{'X-Music-Delivery':'direct'}});
 });
 it.each(['https://music.kmhomelab.cn:2443/cloudmusic/music/42.mp3','https://minio.example/42.mp3','https://m801.music.126.net.evil.test/42.mp3','http://m801.music.126.net/42.mp3'])('rejects owned or unsafe audio %s',async url=>{
  const api=createMusicApi(vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({trackID:'netease:42',status:'available',delivery:'direct',url}))));
  expect(await api.resolve('netease:42')).toMatchObject({status:'unavailable'});
 });
 it('fails closed against an older cache-enabled API',async()=>{
  const api=createMusicApi(vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({trackID:'netease:42',status:'available',url:'https://m801.music.126.net/42.mp3'}))));
  expect(await api.resolve('netease:42')).toMatchObject({status:'unavailable'});
 });
 it('accepts a Kuwo CDN for a NetEase track only with verified UNM edition metadata',async()=>{
  const value={trackID:'netease:42',status:'available',delivery:'direct',url:'https://kw-lv.kuwo.cn/43.mp3',mediaSource:'unm:kuwo',originTrackID:'kuwo:43',matchMethod:'title_artist_album_duration',verification:'id_and_duration'};
  const resolve=(data:unknown)=>createMusicApi(vi.fn(async()=>Response.json(data))).resolve('netease:42');
  expect(await resolve(value)).toMatchObject({status:'available',originTrackID:'kuwo:43'});
  expect(await resolve({...value,originTrackID:'netease:42'})).toMatchObject({status:'unavailable'});
  expect(await resolve({...value,verification:'audio_prefix'})).toMatchObject({status:'unavailable'});
  expect(await resolve({...value,url:'https://kw-lv.kuwo.cn.invalid/43.mp3'})).toMatchObject({status:'unavailable'});
 });
 it('clears legacy MinIO artwork on history and shared/exported library responses',async()=>{
  const track={id:'netease:42',source:'netease',externalID:'42',title:'song',artist:'',album:'',picture:'/music-api/v1/tracks/netease:42/artwork',durationMs:200000};
  const api=createMusicApi(vi.fn(async(input:string|URL|Request)=>new Response(JSON.stringify(String(input).endsWith('/history')?{history:[{track,positionMs:0,playedAt:''}]}:{format:'betago-music',version:1,likes:[track],playlists:[{name:'shared',tracks:[track]}]}))));
  expect((await api.history())[0]?.track.picture).toBe('');
  expect((await api.shared('test')).playlists[0]?.tracks[0]?.picture).toBe('');
  expect((await api.exportData()).likes[0]?.picture).toBe('');
 });
 it('never fetches old card descriptors or uses their signed music URL',async()=>{
  const track={id:'netease:42',source:'netease',externalID:'42',title:'canonical',artist:'artist',album:'',picture:'',durationMs:200000};
  const fetcher=vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({tracks:[track]})));
  const api=createMusicApi(fetcher);expect(await api.legacyDescriptor('https://music.kmhomelab.cn:2443/cloudmusic/info/42.json?X-Amz-Signature=old')).toEqual(track);
  expect(fetcher.mock.calls.map(c=>String(c[0]))).toEqual(['/music-api/v1/tracks/details']);
  await expect(api.legacyDescriptor('https://objects.test/unknown.json')).rejects.toThrow('歌曲');
 });
});
