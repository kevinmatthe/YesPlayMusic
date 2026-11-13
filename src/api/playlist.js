import { api, toPlayer } from './music';
import request from '@/utils/request';
import { mapTrackPlayableStatus } from '@/utils/common';

/**
 * 推荐歌单
 * 说明 : 调用此接口 , 可获取推荐歌单
 * - limit: 取出数量 , 默认为 30 (不支持 offset)
 * - 调用例子 : /personalized?limit=1
 * @param {Object} params
 * @param {number=} params.limit
 */
export function recommendPlaylist(params) {
  return request({
    url: '/personalized',
    method: 'get',
    params,
  });
}
/**
 * 获取每日推荐歌单
 * 说明 : 调用此接口 , 可获得每日推荐歌单 ( 需要登录 )
 * @param {Object} params
 * @param {number=} params.limit
 */
export function dailyRecommendPlaylist(params) {
  return request({
    url: '/recommend/resource',
    method: 'get',
    params: {
      params,
      timestamp: Date.now(),
    },
  });
}
/**
 * 获取歌单详情
 * 说明 : 歌单能看到歌单名字, 但看不到具体歌单内容 , 调用此接口 , 传入歌单 id, 可以获取对应歌单内的所有的音乐(未登录状态只能获取不完整的歌单,登录后是完整的)，
 * 但是返回的trackIds是完整的，tracks 则是不完整的，可拿全部 trackIds 请求一次 song/detail 接口
 * 获取所有歌曲的详情 (https://github.com/Binaryify/NeteaseCloudMusicApi/issues/452)
 * - id : 歌单 id
 * - s : 歌单最近的 s 个收藏者, 默认为8
 * @param {number} id
 * @param {boolean=} noCache
 */
export async function getPlaylistDetail(id) {
  const p = await api('/playlists/' + encodeURIComponent(id));
  return {
    playlist: {
      ...p,
      tracks: p.tracks.map(toPlayer),
      trackIds: p.tracks.map(t => ({ id: t.id })),
    },
  };
}

export function highQualityPlaylist(params) {
  return request({
    url: '/top/playlist/highquality',
    method: 'get',
    params,
  });
}

/**
 * 歌单 ( 网友精选碟 )
 * 说明 : 调用此接口 , 可获取网友精选碟歌单
 * - order: 可选值为 'new' 和 'hot', 分别对应最新和最热 , 默认为 'hot'
 * - cat: tag, 比如 " 华语 "、" 古风 " 、" 欧美 "、" 流行 ", 默认为 "全部",可从歌单分类接口获取(/playlist/catlist)
 * - limit: 取出歌单数量 , 默认为 50
 * @param {Object} params
 * @param {string} params.order
 * @param {string} params.cat
 * @param {number=} params.limit
 */
export function topPlaylist(params) {
  return request({
    url: '/top/playlist',
    method: 'get',
    params,
  });
}

/**
 * 歌单分类
 * 说明 : 调用此接口,可获取歌单分类,包含 category 信息
 */
export function playlistCatlist() {
  return request({
    url: '/playlist/catlist',
    method: 'get',
  });
}

/**
 * 所有榜单
 * 说明 : 调用此接口,可获取所有榜单 接口地址 : /toplist
 */
export function toplists() {
  return request({
    url: '/toplist',
    method: 'get',
  });
}

/**
 * 收藏/取消收藏歌单
 * 说明 : 调用此接口, 传入类型和歌单 id 可收藏歌单或者取消收藏歌单
 * - t : 类型,1:收藏,2:取消收藏
 * - id : 歌单 id
 * @param {Object} params
 * @param {number} params.t
 * @param {number} params.id
 */
export function subscribePlaylist() {
  return Promise.reject(new Error('请通过自有只读分享链接复制歌单'));
}

export async function deletePlaylist(id, revision) {
  if (revision === undefined)
    throw new Error('删除需要歌单 revision，请重新载入后操作');
  return api('/playlists/' + encodeURIComponent(id), 'DELETE', { revision });
}

export async function createPlaylist(params) {
  const playlist = await api('/playlists', 'POST', {
    name: params.name,
    trackIDs: [],
  });
  return { code: 200, playlist };
}

export async function addOrRemoveTrackFromPlaylist(params) {
  const p = await api('/playlists/' + encodeURIComponent(params.pid));
  const changed = Array.isArray(params.tracks)
    ? params.tracks
    : String(params.tracks).split(',');
  const ids = p.tracks.map(t => t.id);
  const trackIDs =
    params.op === 'del'
      ? ids.filter(id => !changed.includes(id))
      : Array.from(new Set([...ids, ...changed]));
  await api('/playlists/' + encodeURIComponent(params.pid), 'PUT', {
    name: p.name,
    trackIDs,
    revision: params.revision ?? p.revision,
  });
  return { body: { code: 200 } };
}

export function dailyRecommendTracks() {
  return request({
    url: '/recommend/songs',
    method: 'get',
    params: { timestamp: new Date().getTime() },
  }).then(result => {
    result.data.dailySongs = mapTrackPlayableStatus(
      result.data.dailySongs,
      result.data.privileges
    );
    return result;
  });
}

/**
 * 心动模式/智能播放
 * 说明 : 登录后调用此接口 , 可获取心动模式/智能播放列表 必选参数 : id : 歌曲 id
 * - id : 歌曲 id
 * - pid : 歌单 id
 * - sid : 要开始播放的歌曲的 id (可选参数)
 * @param {Object} params
 * @param {number=} params.id
 * @param {number=} params.pid
 */
export function intelligencePlaylist(params) {
  return request({
    url: '/playmode/intelligence/list',
    method: 'get',
    params,
  });
}
