import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createDeviceAudioCache } from './device-audio-cache';
import { hasVerifiedKuwoMatch } from './audio-source';
import type { DeviceCacheOptions } from './device-audio-cache';
import { normalizeAssociation } from '../recommendation-association'
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
export function isExternalAudioURL(raw: unknown, trackID: string, source?: Partial<Resolution>): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port) return false;
    const h = u.hostname.toLowerCase();
    if (hasVerifiedKuwoMatch(trackID, source)) return h === 'kuwo.cn' || h.endsWith('.kuwo.cn');
    if (trackID.startsWith('netease:')) return h === 'music.126.net' || h.endsWith('.music.126.net') || h === 'music.163.com' || h.endsWith('.music.163.com');
    if (trackID.startsWith('kuwo:')) return h === 'kuwo.cn' || h.endsWith('.kuwo.cn');
    return false;
  } catch { return false; }
}
export function createMusicApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
): MusicApi {
  let guest: Promise<Session> | undefined;
  const metadata = new Map<string, Track>();
  async function request<T>(
    path: string,
    method = 'GET',
    data?: unknown,
    keepalive = false,
    signal?: AbortSignal
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: { 'X-Music-Delivery': 'direct', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
        body: data === undefined ? undefined : JSON.stringify(data),
        keepalive,
        ...(signal ? {signal} : {}),
      });
    } catch (error) {
      if(signal?.aborted)throw error;
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
          : raw === 'database_not_configured'
          ? '这个部署尚未关联独立音乐数据库。'
          : raw === 'database_migration_required'
          ? '独立音乐数据库还需要执行迁移。'
          : raw === 'database_scope_mismatch' || raw === 'database_scope_missing' || raw === 'database_configuration_invalid'
          ? '音乐数据库配置与当前部署环境不一致。'
          : raw === 'music_service_unavailable'
          ? '音乐服务暂不可用，请稍后重试。'
          : response.status === 401
          ? '会话已过期，请使用恢复码重新打开音乐空间。'
          : raw;
      throw new MusicApiError(response.status, message);
    }
    // Historical rows and shared/exported libraries can retain old object URLs.
    // Strip these at every JSON boundary, before any view creates an <img>.
    const normalize = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(normalize); return; }
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.source === 'string' && typeof record.picture === 'string' && /\/cloudmusic\/|\/music-api\/v1\/tracks\/.*\/artwork/.test(record.picture)) record.picture = '';
      Object.values(record).forEach(normalize);
    };
    normalize(result);
    return result as T;
  }
  function remember(tracks: Track[]) {
    tracks.forEach(t => {
      if (/\/cloudmusic\/|\/music-api\/v1\/tracks\/.*\/artwork/.test(t.picture)) t.picture = '';
      metadata.set(t.id, t);
    });
    return tracks;
  }
  function reset() {
    guest = undefined;
    metadata.clear();
  }
  const api: MusicApi = {
    async recommendations(limit=12,signal,options){
      const query=new URLSearchParams({limit:String(limit)})
      if(options?.refresh)query.set('refresh',options.refresh)
      if(options?.exclude?.length)query.set('exclude',options.exclude.slice(0,50).join(','))
      const result=await request<Recommendations>('/recommendations?'+query,'GET',undefined,false,signal)
      result.tracks=result.tracks.map(item=>{
        const {association:raw,...rest}=item,association=normalizeAssociation(raw)
        return {...rest,...(association?{association}:{})}
      })
      remember(result.tracks.map(item=>item.track))
      return result
    },
    searchHistory:(limit=20,signal)=>request<{searches:SearchRecord[]}>('/search-history?limit='+E(String(limit)),'GET',undefined,false,signal),
    recordSearch:async(query,source,signal)=>{await request('/search-history','POST',{query,source},false,signal)},
    clearSearchHistory:async(signal)=>{await request('/search-history','DELETE',{},false,signal)},
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
    async search(q, source,signal) {
      return remember(
        (await request<{ tracks: Track[] }>('/search?q=' + E(q) + (source ? '&source=' + E(source) : ''),'GET',undefined,false,signal)).tracks
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
      if (!/^(netease|kuwo):[1-9][0-9]*$/.test(id))
        return {trackID:id,status:'unavailable',reason:'这首旧卡片歌曲没有可识别的音源，请搜索后播放。'};
      const out = await request<Resolution>('/tracks/' + E(id) + '/resolve', 'POST', {delivery:'direct'});
      const playable = out.status === 'available' || out.status === 'preview';
      if (!['available','preview','unavailable'].includes(out.status) || out.delivery !== 'direct' || out.trackID !== id || (playable && !isExternalAudioURL(out.url, id, out)))
        return {trackID:id,status:'unavailable',reason:'当前服务未提供可用的直连音源，请稍后重试。',diagnosticReason:'direct_audio_required'};
      if (out.status === 'unavailable') {
        const reason = out.reason || '';
        const hints:Record<string,string> = {
          provider_access_denied:'这个音源暂不允许播放这首歌。',
          provider_rate_limited:'音源请求较多，请稍后重试。',
          account_budget_exhausted:'音源请求较多，请稍后重试。',
          provider_preview_requires_official_player:'这首歌仅能在音源官方播放器中试听。',
          audio_duration_mismatch:'音源的实际时长与歌曲不符，暂时无法播放。',
          external_audio_url_rejected:'音源返回的地址无法直接播放，请稍后重试。',
        };
        return {...out,url:undefined,expiresAt:undefined,diagnosticReason:reason,reason:hints[reason] || '外部音源暂不可用或受限，请稍后重试或选择其他歌曲。'};
      }
      return out;
    },
    lyrics: id => request<Lyrics>('/tracks/' + E(id) + '/lyrics'),
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
    setLike: async (id, like,signal) => {
      await request(
        '/likes/' + E(id),
        like ? 'PUT' : 'DELETE',
        like ? {} : undefined,
        false,signal
      );
    },
    history: async () => {
      const result = (await request<{ history: HistoryItem[] }>('/history')).history;
      remember(result.map(item => item.track));
      return result;
    },
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
    shared: async token => {
      const result = await request<ExportData>('/shared/' + E(token));
      remember([...result.likes, ...result.playlists.flatMap(p => p.tracks)]);
      return result;
    },
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
      let url: URL;
      try { url = new URL(raw); } catch { throw new MusicApiError(400,'旧卡片歌曲地址无效，请搜索后播放。'); }
      // Read only the identity encoded in the link. Never fetch MinIO's
      // descriptor, its signed MusicURL, or its cached lyrics from this web app.
      const match = decodeURIComponent(url.pathname).match(/\/(?:info|catalog)\/(?:(netease|kuwo)\/)?([1-9][0-9]*)\.json$/);
      if (!['https:','http:'].includes(url.protocol) || !match)
        throw new MusicApiError(400,'旧卡片没有可识别的歌曲，请搜索后播放。');
      const id = `${match[1] || 'netease'}:${match[2]}`;
      const tracks = await api.details([id]);
      return tracks[0]!;
    },
  };
  return api;
}
// Keep the raw factory's direct-delivery/status/host checks unchanged. Only the
// live client is decorated, and every miss passes through that same factory.
export function createDeviceCachedMusicApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  options: Omit<DeviceCacheOptions,'fetcher'|'externalAudioURL'|'resolveRemote'|'blockedAudioHosts'> = {}
) {
  return createDeviceAudioCache(createMusicApi(fetcher), {
    ...options,
    fetcher,
    externalAudioURL: (url, trackID, source) => isExternalAudioURL(url.href, trackID, source),
    blockedAudioHosts: ['kmhomelab.cn'],
  });
}
export const deviceAudioCache = createDeviceCachedMusicApi();
export const musicApi = deviceAudioCache.api;
