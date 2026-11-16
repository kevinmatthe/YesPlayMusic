import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  AuthOptions,
  CatalogueOptions,
  Recommendations,
  SearchRecord,
  PlaylistImportResult,
  ExportData,
  HistoryItem,
  Lyrics,
  MusicApi,
  Playlist,
  Queue,
  Resolution,
  Session,
  Share,
  Track,
} from './types';

export class MusicApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'MusicApiError';
  }
}
const BASE = '/music-api/v1';
const E = (value: string) => encodeURIComponent(value);
export async function descriptorIdentity(raw: string): Promise<string> {
  const url = new URL(raw);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (
      /^(x-amz-|x-oss-)/i.test(key) ||
      /^(AWSAccessKeyId|Signature|Expires|OSSAccessKeyId)$/i.test(key)
    )
      url.searchParams.delete(key);
  url.searchParams.sort();
  return 'legacy:' + bytesToHex(sha256(new TextEncoder().encode(url.href)));
}
function safeURL(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
export function createMusicApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
): MusicApi {
  let guest: Promise<Session> | undefined;
  const metadata = new Map<string, Track>();
  const legacy = new Map<
    string,
    { url: string; lyricsURL: string; expiresAt: number }
  >();
  async function request<T>(
    path: string,
    method = 'GET',
    data?: unknown,
    keepalive = false
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
        keepalive,
      });
    } catch {
      throw new MusicApiError(503, '无法连接音乐服务，请检查网络后重试');
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new MusicApiError(response.status || 503, '音乐服务响应无效');
    }
    if (!response.ok) {
      const raw = (result as { error?: string }).error || '请求失败';
      const message =
        response.status === 409
          ? '内容已在其他窗口更新，请重新载入后再编辑。'
          : raw === 'origin_denied'
          ? '当前访问地址与音乐服务入口不一致，请从正式音乐网页重新打开。'
          : raw === 'session_required'
          ? '当前浏览器尚未建立音乐会话，请重新载入页面自动创建访客空间。'
          : raw === 'feishu_code_rejected'
          ? '飞书临时授权未通过，请在飞书内重新授权。'
          : raw === 'feishu_not_configured'
          ? '飞书登录尚未启用，访客空间仍可使用。'
          : response.status === 401
          ? '会话已过期，请使用恢复码重新打开音乐空间。'
          : raw;
      throw new MusicApiError(response.status, message);
    }
    return result as T;
  }
  function remember(tracks: Track[]) {
    tracks.forEach(t => metadata.set(t.id, t));
    return tracks;
  }
  function reset() {
    guest = undefined;
    metadata.clear();
    legacy.clear();
  }
  const api: MusicApi = {
    async recommendations(limit=12){
      const result=await request<Recommendations>('/recommendations?limit='+E(String(limit)))
      remember(result.tracks.map(item=>item.track))
      return result
    },
    searchHistory:(limit=20)=>request<{searches:SearchRecord[]}>('/search-history?limit='+E(String(limit))),
    recordSearch:async(query,source)=>{await request('/search-history','POST',{query,source})},
    clearSearchHistory:async()=>{await request('/search-history','DELETE',{})},
    async importNetEasePlaylist(urlOrID,name){
      const input=urlOrID.trim()
      if(!input)throw new MusicApiError(400,'请输入公开网易歌单链接或数字 ID。')
      let result:PlaylistImportResult
      try{result=await request<PlaylistImportResult>('/imports/netease-playlist','POST',{urlOrID:input,...(name?.trim()?{name:name.trim()}: {})})}
      catch(error){
        if(error instanceof MusicApiError){
          const hints:Record<string,string>={netease_playlist_full_url_required:'短链接暂不支持，请复制完整的网易公开歌单链接或填写数字 ID。',invalid_name:'新歌单名称需为 1–100 个字符。',public_playlist_empty:'公开歌单里没有可导入的曲目。',public_playlist_metadata_incomplete:'部分曲目信息缺失，本次未创建歌单，请稍后重试。',public_playlist_import_not_configured:'公开歌单导入尚未配置，请稍后重试。',provider_rate_limited:'网易曲库请求较多，请稍后再导入。'}
          if(hints[error.message])throw new MusicApiError(error.status,hints[error.message])
          if(error.status===413||/too_large|too_many|limit_exceeded/.test(error.message))throw new MusicApiError(error.status,'歌单超过可导入上限（1000 首），请先拆分后重试。')
          if([403,404].includes(error.status))throw new MusicApiError(error.status,'无法读取这个公开歌单，可能为私有、受限或链接已失效。')
          if(error.status===400)throw new MusicApiError(error.status,'请输入有效的公开网易歌单链接或数字 ID。')
          if(error.status===422)throw new MusicApiError(error.status,'歌单里没有可导入的有效曲目，或曲目信息暂不可用。')
          if(error.status>=500)throw new MusicApiError(error.status,'曲库暂不可用，请稍后再导入。')
        }
        throw error
      }
      if(!result.playlist?.id||!Array.isArray(result.playlist.tracks)||!Number.isFinite(result.imported)||!Number.isFinite(result.duplicatesSkipped)||!result.sourcePlaylistID)throw new MusicApiError(502,'导入结果暂时不完整，请刷新歌单确认是否已创建。')
      remember(result.playlist.tracks)
      return result
    },
    authOptions: () => request<AuthOptions>('/auth/options'),
    catalogOptions: () => request<CatalogueOptions>('/catalog/options'),
    ensureGuest() {
      return (guest ??= request<Session>('/auth/guest', 'POST', {}).catch(e => {
        guest = undefined;
        throw e;
      }));
    },
    me: () => request<Session>('/me'),
    async search(q, source) {
      return remember(
        (await request<{ tracks: Track[] }>('/search?q=' + E(q) + (source ? '&source=' + E(source) : ''))).tracks
      );
    },
    async details(ids) {
      const need = [...new Set(ids.filter(id => !metadata.has(id)))];
      if (need.length)
        remember(
          (
            await request<{ tracks: Track[] }>('/tracks/details', 'POST', {
              ids: need,
            })
          ).tracks
        );
      return ids.map(id => {
        const track = metadata.get(id);
        if (!track) throw new MusicApiError(404, '找不到歌曲 ' + id);
        return track;
      });
    },
    async resolve(id) {
      const old = legacy.get(id);
      const legacyResolution = (): Resolution =>
        old && old.url && old.expiresAt > Date.now()
          ? {
              trackID: id,
              status: 'available',
              url: old.url,
              expiresAt: new Date(old.expiresAt).toISOString(),
              reason: 'legacy_descriptor_source',
            }
          : {
              trackID: id,
              status: 'unavailable',
              reason: '旧卡片音源已过期，请重新打开卡片',
            };
      if (id.startsWith('legacy:')) return legacyResolution();
      try {
        return await request<Resolution>(
          '/tracks/' + E(id) + '/resolve',
          'POST',
          {}
        );
      } catch (e) {
        if (e instanceof MusicApiError && e.status === 503 && old)
          return legacyResolution();
        throw e;
      }
    },
    async lyrics(id) {
      const old = legacy.get(id);
      if (old?.lyricsURL) {
        const response = await fetcher(old.lyricsURL, { credentials: 'omit' });
        if (!response.ok)
          throw new MusicApiError(response.status, '旧卡片歌词地址已过期');
        const value = (await response.json()) as {
          lrc?: { lyric?: string };
          tlyric?: { lyric?: string };
        };
        return {
          trackID: id,
          lrc: value.lrc?.lyric || '',
          translatedLrc: value.tlyric?.lyric || '',
        };
      }
      return request<Lyrics>('/tracks/' + E(id) + '/lyrics');
    },
    async listPlaylists() {
      const result = await request<{ playlists: Playlist[] }>('/playlists');
      result.playlists.forEach(p => remember(p.tracks));
      return result.playlists;
    },
    createPlaylist: (name, trackIDs = []) =>
      request<Playlist>('/playlists', 'POST', { name, trackIDs }),
    updatePlaylist: (p, trackIDs, name = p.name) =>
      request<Playlist>('/playlists/' + E(p.id), 'PUT', {
        name,
        trackIDs,
        revision: p.revision,
      }),
    deletePlaylist: async p => {
      await request('/playlists/' + E(p.id), 'DELETE', {
        revision: p.revision,
      });
    },
    async likes() {
      return remember((await request<{ tracks: Track[] }>('/likes')).tracks);
    },
    setLike: async (id, like) => {
      await request(
        '/likes/' + E(id),
        like ? 'PUT' : 'DELETE',
        like ? {} : undefined
      );
    },
    history: async () =>
      (await request<{ history: HistoryItem[] }>('/history')).history,
    clearHistory: async () => {
      await request('/history', 'DELETE');
    },
    recordHistory: async (trackID, positionMs) => {
      await request('/history', 'POST', {
        trackID,
        positionMs: Math.max(0, Math.round(positionMs)),
      });
    },
    queue: device => request<Queue>('/queue/' + E(device)),
    saveQueue: (device, q, keepalive = false) =>
      request<Queue>('/queue/' + E(device), 'PUT', q, keepalive),
    shares: async () => (await request<{ shares: Share[] }>('/shares')).shares,
    createShare: (kind, targetID) =>
      request<{ id: string; token: string }>('/shares', 'POST', {
        kind,
        targetID,
      }),
    revokeShare: async id => {
      await request('/shares/' + E(id), 'DELETE');
    },
    shared: token => request<ExportData>('/shared/' + E(token)),
    copyShare: token =>
      request<{ imported: number }>(
        '/shared/' + E(token) + '/copy',
        'POST',
        {}
      ),
    exportData: () => request<ExportData>('/export'),
    importData: data => request<{ imported: number }>('/import', 'POST', data),
    recovery: async () =>
      (await request<{ recoveryCode: string }>('/auth/recovery', 'POST', {}))
        .recoveryCode,
    async recover(recoveryCode) {
      const session = await request<Session>('/auth/recover', 'POST', {
        recoveryCode,
      });
      reset();
      return session;
    },
    async exchangeFeishu(code) {
      const session = await request<Session>('/auth/feishu/exchange', 'POST', {
        code,
      });
      reset();
      return session;
    },
    refreshFeishuProfile: code => request<Session>('/auth/feishu/profile', 'POST', { code }),
    async logout() {
      await request('/auth/logout', 'POST', {});
      reset();
    },
    async legacyDescriptor(raw) {
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol))
        throw new MusicApiError(400, '旧卡片地址无效');
      const response = await fetcher(url.href, { credentials: 'omit' });
      if (!response.ok)
        throw new MusicApiError(
          response.status,
          '旧卡片描述已过期，请重新打开卡片'
        );
      const data = (await response.json()) as Record<string, unknown>;
      const numeric = decodeURIComponent(url.pathname).match(
        /\/info\/(\d+)\.json$/
      )?.[1];
      const explicit =
        typeof data.TrackID === 'string'
          ? data.TrackID
          : typeof data.Source === 'string' && data.ExternalID != null
          ? `${data.Source}:${String(data.ExternalID)}`
          : numeric
          ? `netease:${numeric}`
          : undefined;
      const id = explicit || (await descriptorIdentity(url.href));
      if (!/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._-]{1,180}$/.test(id))
        throw new MusicApiError(400, '旧卡片歌曲标识无效');
      const artists = Array.isArray(data.Artist)
        ? data.Artist.map(a => String((a as { name?: unknown }).name || ''))
            .filter(Boolean)
            .join(', ')
        : String(data.Artist || '');
      let track: Track = {
        id,
        source: id.slice(0, id.indexOf(':')),
        externalID: id.slice(id.indexOf(':') + 1),
        title: String(data.Title || '旧卡片歌曲'),
        artist: artists,
        album: String(data.Album || ''),
        picture: safeURL(data.PictureURL),
        durationMs: Math.max(0, Number(data.Duration) || 0),
      };
      legacy.set(id, {
        url: safeURL(data.MusicURL),
        lyricsURL: safeURL(data.LyricsURL),
        expiresAt: Date.now() + 300000,
      });
      // Generic descriptors remain browser-memory-only. Known catalogue identities are server-verified.
      if (track.source === 'netease') {
        try {
          track = await request<Track>('/tracks/register', 'POST', { track });
        } catch (error) {
          if (!(error instanceof MusicApiError) || error.status !== 503)
            throw error;
        }
      }
      metadata.set(track.id, track);
      return track;
    },
  };
  return api;
}
export const musicApi = createMusicApi();
