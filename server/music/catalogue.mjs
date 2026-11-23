import select from '@unblockneteasemusic/server/src/provider/select.js'
import kuwoCodec from '@unblockneteasemusic/server/src/kwDES.js'
import { ApiError, invalid, missing, unavailable } from './database.mjs'

const netease = 'https://music.163.com'
const kuwo = 'https://www.kuwo.cn'
const trackIDPattern = /^(netease|kuwo):([1-9][0-9]{0,15})$/
const options = {
  defaultSource: 'netease',
  sources: [{ id: 'netease', name: '网易云' }, { id: 'kuwo', name: '酷我' }],
}

export function trackID(id) {
  const match = typeof id === 'string' && id.match(trackIDPattern)
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw invalid('invalid_track_id')
  return [match[1], match[2]]
}

export function ids(value, max = 1000) {
  if (!Array.isArray(value) || value.length > max) throw invalid('invalid_track_list')
  value.forEach(trackID)
  return value
}

const neteaseHost = host => host === 'music.126.net' || host.endsWith('.music.126.net')
const kuwoHost = host => host === 'kuwo.cn' || host.endsWith('.kuwo.cn')
const timeout = ms => AbortSignal.timeout(ms)
const within = (actual, expected) => expected > 0 && Math.abs(actual - expected) <= Math.min(5000, Math.max(1500, expected * .03))
const text = (value, limit = 300) => (typeof value === 'string' ? value.slice(0, limit) : '')
const recordingText = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const artists = value => value.split(/\s*(?:,|，|&)\s*/).map(recordingText).filter(Boolean).sort().join('|')

function safeURL(raw, hostOK) {
  try {
    const url = new URL(raw)
    if (!['https:', 'http:'].includes(url.protocol) || !hostOK(url.hostname) ||
        url.username || url.password || url.port || url.hash) return
    url.protocol = 'https:'
    return url.href
  } catch {
    return
  }
}

export function artwork(source, raw) {
  return safeURL(raw, source === 'netease' ? neteaseHost : kuwoHost) || ''
}

async function bytes(response, limit, prefix = false) {
  if (!response.body) throw unavailable()
  const reader = response.body.getReader()
  const parts = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (prefix && size + value.length >= limit) {
        parts.push(value.subarray(0, limit - size))
        size = limit
        break
      }
      if (size + value.length > limit) throw unavailable()
      size += value.length
      parts.push(value)
    }
    return Buffer.concat(parts, size)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function request(host, path, params, { signal = timeout(4200), cookie, header, raw = false } = {}) {
  try {
    const url = new URL(path, host)
    url.search = new URLSearchParams(params)
    const response = await fetch(url, {
      signal,
      redirect: 'error',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: (host.includes('kuwo.cn') ? kuwo : netease) + '/',
        ...(cookie ? { Cookie: cookie } : {}),
        ...header,
      },
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 429) throw new ApiError(429, 'provider_rate_limited')
      if ([401, 403, 451].includes(response.status)) throw new ApiError(403, 'provider_access_denied')
      throw unavailable()
    }
    const data = await bytes(response, raw ? 4096 : 4 * 1024 * 1024)
    return raw ? data.toString().trim() : JSON.parse(data.toString())
  } catch (error) {
    throw error instanceof ApiError ? error : unavailable()
  }
}

function netTrack(song) {
  const externalID = String(song?.id ?? '')
  if (!trackIDPattern.test('netease:' + externalID) || !Number.isSafeInteger(song.id) || !song.name) return
  const album = song.al ?? song.album
  const durationMs = song.dt ?? song.duration
  return {
    id: 'netease:' + externalID, source: 'netease', externalID,
    title: text(song.name), artist: (song.ar ?? song.artists ?? []).map(item => text(item.name)).join(', ').slice(0, 300),
    album: text(album?.name), picture: artwork('netease', album?.picUrl),
    durationMs: Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0,
  }
}

function kuwoTrack(song) {
  const externalID = String(song?.id ?? song?.MUSICRID ?? '').replace(/^MUSIC_/, '')
  const title = text(song?.songName ?? song?.SONGNAME)
  if (!title || !trackIDPattern.test('kuwo:' + externalID) || !Number.isSafeInteger(Number(externalID))) return
  const durationMs = Math.round(Number(song.duration ?? song.DURATION ?? 0) * 1000)
  return {
    id: 'kuwo:' + externalID, source: 'kuwo', externalID, title,
    artist: text(song.artist ?? song.ARTIST), album: text(song.album ?? song.ALBUM),
    picture: artwork('kuwo', song.pic ?? song.picurl ?? song.PICURL),
    durationMs: Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0,
  }
}

async function kuwoSearch(query, signal) {
  const data = await request('https://search.kuwo.cn', '/r.s', {
    correct: 1, vipver: 1, stype: 'comprehensive', encoding: 'utf8', rformat: 'json',
    mobi: 1, show_copyright_off: 1, searchapi: 6, all: query,
  }, { signal })
  if (!Array.isArray(data.content)) throw unavailable()
  const list = data.content.find(item => Array.isArray(item.musicpage?.abslist))?.musicpage.abslist ?? []
  return list.slice(0, 30).flatMap(song => {
    const track = kuwoTrack(song)
    if (!track) return []
    const fees = song.payInfo?.feeType
    const free = song.fpay === '0' && fees?.song === '0' && fees?.vip === '0' && song.payInfo?.cannotOnlinePlay === '0'
    return [{ track, free, preview: song.payInfo?.listen_fragment === '1' }]
  })
}

async function kuwoDetail(externalID, signal) {
  const result = await request('https://m.kuwo.cn', '/newh5/singles/songinfoandlrc', { musicId: externalID }, { signal })
  const track = kuwoTrack(result.data?.songinfo)
  if (result.status !== 200 || track?.externalID !== externalID) {
    const match = (await kuwoSearch(externalID, signal)).find(item => item.track.externalID === externalID)
    if (!match) throw missing()
    return { track: match.track, lyrics: [] }
  }
  return { track, lyrics: result.data.lrclist }
}

async function netDetails(externalIDs, signal) {
  const data = await request(netease, '/api/v3/song/detail', {
    c: JSON.stringify(externalIDs.map(id => ({ id: Number(id) }))),
  }, { signal })
  if (data.code !== 200 || !Array.isArray(data.songs)) throw unavailable()
  return data.songs.map(netTrack).filter(Boolean)
}

// Read the MP3 duration from a Xing/Info frame count or a consistent CBR prefix.
function mp3Duration(buffer, length) {
  let start = 0
  if (buffer.toString('ascii', 0, 3) === 'ID3') {
    if (buffer.length < 10 || buffer.subarray(6, 10).some(b => b > 127)) return
    start = 10 + buffer.subarray(6, 10).reduce((size, b) => size * 128 + b, 0)
    if (buffer[3] === 4 && (buffer[5] & 16)) start += 10
  }
  const baseRates = [44100, 48000, 32000]
  const mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const header = offset => {
    const [a, b, c, d] = buffer.subarray(offset, offset + 4)
    const version = (b >> 3) & 3
    if (offset + 4 > buffer.length || a !== 255 || (b & 224) !== 224 ||
        (b & 6) !== 2 || version === 1) return
    const bitrate = (version === 3 ? mpeg1 : mpeg2)[c >> 4]
    const rate = baseRates[(c >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4)
    if (!bitrate || !rate) return
    const samples = version === 3 ? 1152 : 576
    const mono = (d & 192) === 192
    const xing = offset + 4 + ((b & 1) ? 0 : 2) + (version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17))
    return { bitrate, rate, samples, xing, size: Math.floor(samples * 125 * bitrate / rate) + ((c >> 1) & 1) }
  }
  const first = header(start)
  if (!first) return
  if (first.xing + 12 <= buffer.length &&
      ['Xing', 'Info'].includes(buffer.toString('ascii', first.xing, first.xing + 4)) &&
      (buffer.readUInt32BE(first.xing + 4) & 1)) {
    return buffer.readUInt32BE(first.xing + 8) * first.samples * 1000 / first.rate
  }
  let count = 0
  for (let pos = start; pos + 4 <= buffer.length;) {
    const next = header(pos)
    if (!next || next.bitrate !== first.bitrate || next.rate !== first.rate) break
    count++
    pos += next.size
  }
  if (count >= 12) return (length - start) * 8 / first.bitrate
}

async function probe(raw, hostOK, signal, expected) {
  const url = safeURL(raw, hostOK)
  if (!url) return { reason: 'external_audio_url_rejected' }
  try {
    const response = await fetch(url, {
      redirect: 'error', signal,
      headers: { Range: 'bytes=0-65535', 'Accept-Encoding': 'identity' },
    })
    const range = response.headers.get('content-range')?.match(/^bytes 0-\d+\/(\d+)$/)
    const length = Number(response.status === 206 ? range?.[1] : response.headers.get('content-length'))
    if (![200, 206].includes(response.status) || !Number.isSafeInteger(length) || length < 256 ||
        !/^audio\/(?:mpeg|mp3)\b/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel()
      return { reason: 'external_audio_url_rejected' }
    }
    const prefix = await bytes(response, 65536, true)
    const actual = mp3Duration(prefix, length)
    if (!actual || (expected > 0 && !within(actual, expected))) return { reason: 'audio_duration_mismatch' }
    return { url, durationMs: Math.round(actual) }
  } catch {
    return { reason: 'external_audio_url_rejected' }
  }
}

function resolveResult(track, origin, mediaSource, method, media, seconds, preview = false) {
  return {
    trackID: track.id, originTrackID: origin.id, delivery: 'direct',
    status: preview ? 'preview' : 'available', mediaSource, matchMethod: method,
    verification: preview ? 'audio_prefix' : 'id_and_duration',
    url: media.url, expiresAt: new Date(Date.now() + Math.min(300, seconds) * 1000).toISOString(),
  }
}

async function neteaseAudio(track, cookie) {
  const signal = timeout(4000)
  try {
    const data = await request(netease, '/api/song/enhance/player/url', {
      ids: JSON.stringify([Number(track.externalID)]), br: 128000,
    }, { cookie, signal })
    const item = data.data?.[0]
    if (data.code !== 200 || data.data?.length !== 1 || String(item?.id) !== track.externalID) {
      return { reason: 'source_mismatch' }
    }
    if (item.code !== 200 || !item.url) {
      return { reason: 'provider_access_denied', allowFallback: !item.url }
    }
    const preview = !!item.freeTrialInfo
    if (!preview && !within(item.time, track.durationMs)) return { reason: 'audio_duration_mismatch', allowFallback: true }
    const media = await probe(item.url, neteaseHost, signal, preview ? 0 : track.durationMs)
    if (!media.url) return { ...media, allowFallback: true }
    return {
      result: resolveResult(track, track, cookie ? 'netease:account' : 'netease:anonymous',
        'provider_external_id', media, item.expi > 0 ? item.expi : 90, preview),
    }
  } catch (error) {
    return { reason: error instanceof ApiError && error.status < 500 ? error.code : 'external_source_unavailable' }
  }
}

async function kuwoAudio(track, record) {
  const signal = timeout(4000)
  try {
    record ??= (await kuwoSearch(track.title + ' ' + track.artist, signal)).find(item => item.track.id === track.id)
    if (!record?.free) return { reason: record?.preview ? 'provider_preview_requires_official_player' : 'provider_access_denied' }
    const origin = record.track
    const query = 'corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format=mp3&rid=' + origin.externalID
    const body = await request('https://mobi.kuwo.cn', '/mobi.s', {
      f: 'kuwo', q: kuwoCodec.encryptQuery(query),
    }, { signal, raw: true })
    const raw = body.match(/https?:[^\s$"<>]+/)?.[0]
    if (!origin.durationMs || !track.durationMs) return { reason: 'audio_duration_mismatch' }
    const media = await probe(raw, kuwoHost, signal, origin.durationMs)
    if (!media.url) return media
    if (!within(media.durationMs, track.durationMs)) return { reason: 'audio_duration_mismatch' }
    const matched = track.id !== origin.id
    return {
      result: resolveResult(track, origin, matched ? 'unm:kuwo' : 'kuwo:anonymous',
        matched ? 'title_artist_album_duration' : 'provider_external_id', media, 90),
    }
  } catch (error) {
    return { reason: error instanceof ApiError && error.status < 500 ? error.code : 'external_source_unavailable' }
  }
}

export function selectUNMMatch(track, results) {
  if (!track.album || !track.artist || !track.durationMs) return
  const matches = [...new Map(results.filter(candidate =>
    candidate.source === 'kuwo' && /^kuwo:[1-9][0-9]*$/.test(candidate.id) &&
    recordingText(candidate.title) === recordingText(track.title) &&
    artists(candidate.artist) === artists(track.artist) &&
    recordingText(candidate.album) === recordingText(track.album) &&
    within(candidate.durationMs, track.durationMs) && Math.abs(candidate.durationMs - track.durationMs) < 5000
  ).map(candidate => [candidate.id, { ...candidate, duration: candidate.durationMs }])).values()]
  // UNM's selector can fall back to the first result. Only give it a unique edition.
  if (matches.length !== 1) return
  return select(matches, { duration: track.durationMs })
}

export function createCatalogue(env) {
  return {
    options,
    async search(query, source = 'netease', signal) {
      if (source === 'kuwo') return (await kuwoSearch(query, signal)).map(item => item.track)
      if (source !== 'netease') throw invalid('source_not_configured')
      const data = await request(netease, '/api/search/get/web', { s: query, type: 1, limit: 30 }, { signal })
      if (data.code !== 200) throw unavailable()
      const matches = (data.result?.songs ?? []).map(netTrack).filter(Boolean)
      if (!matches.length) return []
      // Legacy search omits covers and some metadata. Enrich in a single request.
      const details = new Map((await netDetails(matches.map(track => track.externalID), signal)).map(track => [track.id, track]))
      return matches.map(track => details.get(track.id) ?? track)
    },
    async details(trackIDs) {
      const grouped = { netease: [], kuwo: [] }
      for (const id of trackIDs) {
        const [source, externalID] = trackID(id)
        grouped[source].push(externalID)
      }
      // Limit new Kuwo lookups. Previously registered tracks never take this path.
      if (grouped.kuwo.length > 25) throw invalid('too_many_unknown_kuwo_tracks')
      const signal = timeout(7000)
      const tracks = []
      for (let offset = 0; offset < grouped.netease.length; offset += 200) {
        tracks.push(...await netDetails(grouped.netease.slice(offset, offset + 200), signal))
      }
      for (let offset = 0; offset < grouped.kuwo.length; offset += 5) {
        const group = await Promise.all(grouped.kuwo.slice(offset, offset + 5).map(id => kuwoDetail(id, signal)))
        tracks.push(...group.map(item => item.track))
      }
      return tracks
    },
    async lyrics(track) {
      if (track.source === 'kuwo') {
        const { lyrics } = await kuwoDetail(track.externalID)
        const lrc = (lyrics ?? []).flatMap(line => {
          const seconds = Number(line.time)
          if (!Number.isFinite(seconds) || seconds < 0) return []
          return ['[' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
            (seconds % 60).toFixed(2).padStart(5, '0') + ']' + text(line.lineLyric, 10000)]
        }).join('\n')
        return { trackID: track.id, lrc, translatedLrc: '' }
      }
      const data = await request(netease, '/api/song/lyric', { id: track.externalID, lv: 1, tv: 1 })
      if (data.code !== 200) throw unavailable()
      return { trackID: track.id, lrc: text(data.lrc?.lyric, 200000), translatedLrc: text(data.tlyric?.lyric, 200000) }
    },
    async resolve(track) {
      let result = track.source === 'kuwo' ? await kuwoAudio(track) : await neteaseAudio(track)
      if (track.source === 'netease' && (result.allowFallback || result.result?.status === 'preview')) {
        if (env.MUSIC_UNM_KUWO !== '0') {
          try {
            const records = await kuwoSearch(track.title + ' ' + track.artist, timeout(3300))
            const match = selectUNMMatch(track, records.map(item => item.track))
            if (match) {
              const fallback = await kuwoAudio(track, records.find(item => item.track.id === match.id))
              if (fallback.result) return fallback.result
              if (!result.result) result = { ...result, reason: fallback.reason }
            }
          } catch {
            // A failed optional match leaves the original provider result available.
          }
        }
        if (env.MUSIC_NETEASE_COOKIE) {
          const account = await neteaseAudio(track, env.MUSIC_NETEASE_COOKIE)
          if (account.result?.status === 'available' || (account.result && !result.result)) return account.result
        }
      }
      return result.result ?? { trackID: track.id, delivery: 'direct', status: 'unavailable', reason: result.reason }
    },
    async publicPlaylist(externalID) {
      const data = await request(netease, '/api/v6/playlist/detail', { id: externalID, n: 0 })
      const playlist = data.playlist
      if (data.code !== 200 || String(playlist?.id) !== externalID || playlist.privacy) throw missing()
      if (playlist.trackCount > 1000 || playlist.trackIds?.length > 1000) throw new ApiError(413, 'too_many_tracks')
      if (!playlist.trackIds?.length) throw new ApiError(422, 'public_playlist_empty')
      if (playlist.trackCount !== playlist.trackIds.length) throw new ApiError(422, 'public_playlist_metadata_incomplete')
      const trackIDs = playlist.trackIds.map(item => 'netease:' + item.id)
      ids(trackIDs)
      return { name: text(playlist.name, 100), trackIDs }
    },
  }
}

export async function lastfmSimilar(key, track, signal) {
  if (!key) return []
  try {
    const data = await request('https://ws.audioscrobbler.com', '/2.0/', {
      method: 'track.getSimilar', api_key: key, artist: track.artist,
      track: track.title, autocorrect: 0, format: 'json', limit: 6,
    }, { signal, header: { Referer: 'https://www.last.fm/' } })
    return (data.similartracks?.track ?? []).slice(0, 6).flatMap(item => {
      if (!item.name || !item.artist?.name) return []
      const match = Number(item.match)
      return [{ title: text(item.name), artist: text(item.artist.name), match: match >= 0 && match <= 1 ? match : undefined }]
    })
  } catch {
    return []
  }
}

export function sameRecordingName(track, relation) {
  return recordingText(track.title) === recordingText(relation.title) && artists(track.artist) === artists(relation.artist)
}
