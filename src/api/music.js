import SHA256 from 'crypto-js/sha256';
// Personal data belongs to BetaGo. Catalogue credentials never enter the browser.
const base = '/music-api/v1';
let opening;
export const catalogue = new Map();
export const legacySources = new Map();
export async function api(path, method = 'GET', data) {
  const response = await fetch(base + path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      response.status === 409
        ? '内容已在其他窗口更新，请重新载入后再编辑。'
        : result.error
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
export function ensureSession() {
  if (!opening)
    opening = api('/auth/guest', 'POST', {}).catch(e => {
      opening = null;
      throw e;
    });
  return opening;
}
export function resetSession() {
  opening = null;
  catalogue.clear();
  legacySources.clear();
}
export function toPlayer(t) {
  catalogue.set(t.id, t);
  return {
    id: t.id,
    name: t.title,
    ar: [{ id: 0, name: t.artist || '未知歌手' }],
    al: { id: 0, name: t.album, picUrl: t.picture || '/music-cover.svg' },
    dt: t.durationMs,
    alia: [],
    tns: [],
    playable: true,
    source: t.source,
  };
}
export async function details(ids) {
  await ensureSession();
  const missing = ids.filter(id => !catalogue.has(id));
  if (missing.length) {
    const result = await api('/tracks/details', 'POST', { ids: missing });
    result.tracks.forEach(toPlayer);
  }
  return ids.map(id => toPlayer(catalogue.get(id)));
}
export async function legacyTarget(targetURL) {
  const u = new URL(targetURL);
  if (!['https:', 'http:'].includes(u.protocol))
    throw new Error('旧卡片地址无效');
  const response = await fetch(u.href, { credentials: 'omit' });
  if (!response.ok) throw new Error('旧卡片描述已过期，请重新打开卡片');
  const d = await response.json();
  const numeric = u.pathname.match(/\/info\/(\d+)\.json$/)?.[1];
  let id =
    d.TrackID ||
    (d.Source && d.ExternalID
      ? `${d.Source}:${d.ExternalID}`
      : numeric
      ? `netease:${numeric}`
      : null);
  if (!id) {
    id = 'legacy:' + SHA256(u.origin + u.pathname).toString();
  }
  const t = {
    id,
    source: id.split(':')[0],
    externalID: id.split(':')[1],
    title: d.Title || '旧卡片歌曲',
    artist: Array.isArray(d.Artist)
      ? d.Artist.map(a => a.name).join(', ')
      : d.Artist || '',
    album: d.Album || '',
    picture: d.PictureURL || '',
    durationMs: d.Duration || 0,
  };
  toPlayer(t);
  legacySources.set(id, {
    url: d.MusicURL,
    lyricsURL: d.LyricsURL,
    expiresAt: Date.now() + 300000,
  });
  // Import metadata only. No signed descriptor/audio URLs are persisted.
  await api('/tracks/register', 'POST', { track: t });
  return t;
}
export async function resolveTrack(id) {
  if (legacySources.has(id) && id.startsWith('legacy:')) {
    const v = legacySources.get(id);
    if (v.expiresAt <= Date.now())
      return {
        trackID: id,
        status: 'unavailable',
        reason: '旧卡片地址已过期，请重新打开卡片',
      };
    return {
      trackID: id,
      status: 'available',
      url: v.url,
      expiresAt: new Date(v.expiresAt).toISOString(),
    };
  }
  try {
    return await api(`/tracks/${encodeURIComponent(id)}/resolve`, 'POST', {});
  } catch (e) {
    // Old cards may still carry a working URL for this exact recording during an upstream outage.
    // Never fall back after an explicit restriction/unavailable result.
    const old = legacySources.get(id);
    if (e.status === 503 && old?.url && old.expiresAt > Date.now())
      return {
        trackID: id,
        status: 'available',
        url: old.url,
        expiresAt: new Date(old.expiresAt).toISOString(),
        reason: 'legacy_descriptor_during_provider_outage',
      };
    throw e;
  }
}
export async function trackLyrics(id) {
  const legacy = legacySources.get(id);
  if (legacy?.lyricsURL) {
    const r = await fetch(legacy.lyricsURL, { credentials: 'omit' });
    if (!r.ok) throw new Error('旧卡片歌词地址已过期');
    const v = await r.json();
    return {
      trackID: id,
      lrc: v.lrc || { lyric: '' },
      tlyric: v.tlyric || { lyric: '' },
      romalrc: v.romalrc || { lyric: '' },
    };
  }
  const v = await api(`/tracks/${encodeURIComponent(id)}/lyrics`);
  return {
    trackID: v.trackID,
    lrc: { lyric: v.lrc },
    tlyric: { lyric: v.translatedLrc },
    romalrc: { lyric: '' },
  };
}
export function deviceID() {
  let id = localStorage.getItem('music-device');
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b =>
          b.toString(16).padStart(2, '0')
        ).join('');
    localStorage.setItem('music-device', id);
  }
  return id;
}
