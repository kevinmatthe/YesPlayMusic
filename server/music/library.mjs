import { ApiError, conflict, invalid, missing, transaction } from './database.mjs'
import { artwork, ids, lastfmSimilar, sameRecordingName, trackID } from './catalogue.mjs'
import { digest, secret } from './identity.mjs'

const ok = { ok: true }
const maxPosition = 86400000
const devicePattern = /^[A-Za-z0-9_-]{1,128}$/
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/
const emptyQueue = { revision: 0, trackIDs: [], currentIndex: 0, positionMs: 0 }
const playlistSelect = `
  SELECT p.id, p.name, p.revision, COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY e.position)
    FROM music_entries e JOIN music_tracks t ON t.id = e.track_id WHERE e.playlist_id = p.id
  ), '[]') AS tracks
  FROM music_playlists p WHERE p.owner_id = $1 AND NOT p.deleted`

export function cleanQuery(query) {
  const value = typeof query === 'string' ? query.trim() : ''
  if (!value || [...value].length > 200 || value.includes('\0')) throw invalid('invalid_query')
  return value
}

export function sourceID(input) {
  const source = input || 'netease'
  if (source !== 'netease' && source !== 'kuwo') throw invalid('source_not_configured')
  return source
}

function nameOf(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed || [...trimmed].length > 100 || trimmed.includes('\0')) throw invalid('invalid_name')
  return trimmed
}

function number(value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw invalid('invalid_number')
  return value
}

function trackFromDB(row) {
  return {
    id: row.id, source: row.source, externalID: row.external_id, title: row.title, artist: row.artist,
    album: row.album, picture: artwork(row.source, row.picture), durationMs: Number(row.duration_ms),
  }
}

function playlistFromDB(row) {
  return { id: row.id, name: row.name, revision: Number(row.revision), tracks: row.tracks.map(trackFromDB) }
}

export async function saveTracks(db, tracks) {
  if (!tracks.length) return
  const distinct = [...new Map(tracks.map(track => [track.id, track])).values()].sort((a, b) => a.id.localeCompare(b.id))
  await db.query(`
    INSERT INTO music_tracks (id, source, external_id, title, artist, album, picture, duration_ms)
    SELECT id, source, "externalID", title, artist, album, picture, "durationMs"
    FROM jsonb_to_recordset($1::jsonb) AS t(
      id text, source text, "externalID" text, title text, artist text, album text, picture text, "durationMs" bigint
    )
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title,
      artist = COALESCE(NULLIF(EXCLUDED.artist, ''), music_tracks.artist),
      album = COALESCE(NULLIF(EXCLUDED.album, ''), music_tracks.album),
      picture = COALESCE(NULLIF(EXCLUDED.picture, ''), music_tracks.picture),
      duration_ms = COALESCE(NULLIF(EXCLUDED.duration_ms, 0), music_tracks.duration_ms)`, [JSON.stringify(distinct)])
}

export async function ensureTracks(db, catalogue, rawIDs) {
  const trackIDs = ids(rawIDs)
  if (!trackIDs.length) return []
  const distinct = [...new Set(trackIDs)]
  const { rows } = await db.query('SELECT * FROM music_tracks WHERE id = ANY($1::text[])', [distinct])
  const tracks = new Map(rows.map(row => [row.id, trackFromDB(row)]))
  const needed = distinct.filter(id => !tracks.has(id))
  if (needed.length) {
    const fresh = await catalogue.details(needed)
    for (const track of fresh) tracks.set(track.id, track)
    if (needed.some(id => !tracks.has(id))) throw missing()
    await saveTracks(db, fresh)
  }
  return trackIDs.map(id => tracks.get(id))
}

async function playlist(db, owner, id) {
  const { rows: [row] } = await db.query(playlistSelect + ' AND p.id = $2', [owner, id])
  if (!row) throw missing()
  return playlistFromDB(row)
}

async function playlists(db, owner) {
  const { rows } = await db.query(playlistSelect + ' ORDER BY p.id', [owner])
  return rows.map(playlistFromDB)
}

async function entries(db, id, trackIDs) {
  const unique = [...new Set(trackIDs)]
  await db.query('DELETE FROM music_entries WHERE playlist_id = $1', [id])
  await db.query(`
    INSERT INTO music_entries (playlist_id, track_id, position)
    SELECT $1, item, ordinal - 1 FROM unnest($2::text[]) WITH ORDINALITY AS items(item, ordinal)`, [id, unique])
}

async function createPlaylist(db, owner, name, trackIDs) {
  const id = secret()
  await db.query('INSERT INTO music_playlists(id, owner_id, name) VALUES ($1, $2, $3)', [id, owner, name])
  await entries(db, id, trackIDs)
  return playlist(db, owner, id)
}

export async function playlistRoute(db, catalogue, owner, method, id, body) {
  if (method === 'GET') return id ? playlist(db, owner, id) : { playlists: await playlists(db, owner) }
  if (!id && method === 'POST') {
    const name = nameOf(body.name)
    const trackIDs = body.trackIDs ?? []
    await ensureTracks(db, catalogue, trackIDs)
    return transaction(db, tx => createPlaylist(tx, owner, name, trackIDs))
  }
  if (!id || !['PUT', 'DELETE'].includes(method)) throw missing()
  const revision = number(body.revision)
  const name = method === 'PUT' ? nameOf(body.name) : ''
  const trackIDs = body.trackIDs ?? []
  if (method === 'PUT') {
    const current = await playlist(db, owner, id)
    if (current.revision !== revision) throw conflict()
    await ensureTracks(db, catalogue, trackIDs)
  }
  return transaction(db, async tx => {
    const { rows: [row] } = await tx.query('SELECT revision, deleted FROM music_playlists WHERE id = $1 AND owner_id = $2 FOR UPDATE', [id, owner])
    if (!row || row.deleted) throw missing()
    if (Number(row.revision) !== revision) throw conflict()
    if (method === 'DELETE') {
      await tx.query('UPDATE music_playlists SET deleted = true, revision = revision + 1 WHERE id = $1 AND owner_id = $2', [id, owner])
      return ok
    }
    await tx.query('UPDATE music_playlists SET name = $1, revision = revision + 1 WHERE id = $2 AND owner_id = $3', [name, id, owner])
    await entries(tx, id, trackIDs)
    return playlist(tx, owner, id)
  })
}

async function likes(db, owner) {
  const { rows } = await db.query(`
    SELECT t.* FROM music_likes l JOIN music_tracks t ON t.id = l.track_id
    WHERE l.owner_id = $1 ORDER BY t.id`, [owner])
  return rows.map(trackFromDB)
}

export async function likeRoute(db, catalogue, owner, method, id) {
  if (method === 'GET' && !id) return { tracks: await likes(db, owner) }
  if (!id || !['PUT', 'DELETE'].includes(method)) throw missing()
  trackID(id)
  if (method === 'PUT') {
    await ensureTracks(db, catalogue, [id])
    await db.query('INSERT INTO music_likes(owner_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, id])
  } else {
    await db.query('DELETE FROM music_likes WHERE owner_id = $1 AND track_id = $2', [owner, id])
  }
  return ok
}

async function recentHistory(db, owner) {
  const { rows } = await db.query(`
    SELECT t.*, h.position_ms, h.played_at FROM music_history h JOIN music_tracks t ON t.id = h.track_id
    WHERE h.owner_id = $1 ORDER BY h.played_at DESC, h.track_id LIMIT 200`, [owner])
  return rows.map(row => ({ track: trackFromDB(row), positionMs: Number(row.position_ms), playedAt: row.played_at }))
}

export async function historyRoute(db, catalogue, owner, method, body) {
  if (method === 'GET') return { history: await recentHistory(db, owner) }
  if (method === 'DELETE') {
    await db.query('DELETE FROM music_history WHERE owner_id = $1', [owner])
  } else if (method === 'POST') {
    const position = number(body.positionMs, maxPosition)
    const id = body.trackID
    await ensureTracks(db, catalogue, [id])
    await transaction(db, async tx => {
      await tx.query('SELECT id FROM music_users WHERE id = $1 FOR UPDATE', [owner])
      await tx.query(`
        INSERT INTO music_history(owner_id, track_id, position_ms) VALUES ($1, $2, $3)
        ON CONFLICT (owner_id, track_id) DO UPDATE SET position_ms = EXCLUDED.position_ms, played_at = now()`, [owner, id, position])
      await tx.query(`
        DELETE FROM music_history WHERE owner_id = $1 AND track_id IN (
          SELECT track_id FROM music_history WHERE owner_id = $1 ORDER BY played_at DESC, track_id OFFSET 200
        )`, [owner])
    })
  } else throw missing()
  return ok
}

export async function queueRoute(db, catalogue, owner, method, device, body) {
  if (!devicePattern.test(device)) throw invalid('invalid_device')
  if (method === 'GET') {
    const { rows: [row] } = await db.query(`
      SELECT revision, track_ids, current_index, position_ms FROM music_queues WHERE owner_id = $1 AND device_id = $2`, [owner, device])
    return row ? { revision: Number(row.revision), trackIDs: row.track_ids, currentIndex: row.current_index, positionMs: Number(row.position_ms) } : emptyQueue
  }
  if (method !== 'PUT') throw missing()
  const trackIDs = ids(body.trackIDs ?? [])
  const revision = number(body.revision)
  const currentIndex = number(body.currentIndex, Math.max(0, trackIDs.length - 1))
  const positionMs = number(body.positionMs, trackIDs.length ? maxPosition : 0)
  await ensureTracks(db, catalogue, trackIDs)
  await transaction(db, async tx => {
    await tx.query('INSERT INTO music_queues(owner_id, device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, device])
    const result = await tx.query(`
      UPDATE music_queues SET revision = revision + 1, track_ids = $3::jsonb, current_index = $4, position_ms = $5
      WHERE owner_id = $1 AND device_id = $2 AND revision = $6`, [owner, device, JSON.stringify(trackIDs), currentIndex, positionMs, revision])
    if (!result.rowCount) throw conflict()
  })
  return { trackIDs, currentIndex, positionMs, revision: revision + 1 }
}

function exportData(list, liked) {
  return { format: 'betago-music', version: 1, playlists: list.map(({ name, tracks }) => ({ name, tracks })), likes: liked }
}

export async function exportLibrary(db, owner) {
  const [list, liked] = await Promise.all([playlists(db, owner), likes(db, owner)])
  return exportData(list, liked)
}

export async function importLibrary(db, catalogue, owner, body) {
  if (body.format !== 'betago-music' || body.version !== 1 ||
      !Array.isArray(body.playlists) || body.playlists.length > 50 ||
      !Array.isArray(body.likes) || body.likes.length > 1000) throw invalid('unsupported_export')
  const list = body.playlists.map(item => {
    if (!Array.isArray(item?.tracks) || item.tracks.length > 1000) throw invalid('invalid_track_list')
    return { name: nameOf(item.name), trackIDs: item.tracks.map(track => track?.id) }
  })
  const liked = [...new Set(body.likes.map(track => track?.id))]
  const needed = [...new Set([...list.flatMap(item => item.trackIDs), ...liked])]
  await ensureTracks(db, catalogue, needed)
  return transaction(db, async tx => {
    for (const item of list) await createPlaylist(tx, owner, item.name, item.trackIDs)
    await tx.query(`
      INSERT INTO music_likes(owner_id, track_id) SELECT $1, id FROM unnest($2::text[]) AS id ON CONFLICT DO NOTHING`, [owner, liked])
    return { imported: list.length }
  })
}

export async function shareRoute(db, catalogue, owner, method, id, body) {
  if (method === 'GET' && !id) {
    const { rows } = await db.query(`
      SELECT id, kind, target_id AS "targetID", revoked, expires_at AS "expiresAt"
      FROM music_shares WHERE owner_id = $1 ORDER BY id`, [owner])
    return { shares: rows }
  }
  if (method === 'DELETE' && id) {
    const result = await db.query('UPDATE music_shares SET revoked = true WHERE id = $1 AND owner_id = $2', [id, owner])
    if (!result.rowCount) throw missing()
    return ok
  }
  if (method !== 'POST' || id) throw missing()
  const { kind, targetID } = body
  if (kind === 'playlist' && typeof targetID === 'string') await playlist(db, owner, targetID)
  else if (kind === 'track') await ensureTracks(db, catalogue, [targetID])
  else throw invalid('invalid_share')
  const shareID = secret()
  const token = secret()
  await db.query(`
    INSERT INTO music_shares(id, owner_id, hash, kind, target_id, expires_at)
    VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [shareID, owner, digest(token), kind, targetID])
  return { id: shareID, token }
}

export async function readShare(db, catalogue, token) {
  if (!tokenPattern.test(token)) throw missing()
  const { rows: [row] } = await db.query(`
    SELECT owner_id, kind, target_id FROM music_shares WHERE hash = $1 AND NOT revoked AND expires_at > now()`, [digest(token)])
  if (!row) throw missing()
  return row.kind === 'playlist'
    ? exportData([await playlist(db, row.owner_id, row.target_id)], [])
    : exportData([], await ensureTracks(db, catalogue, [row.target_id]))
}

export async function importPublicPlaylist(db, catalogue, owner, body) {
  const raw = typeof body.urlOrID === 'string' ? body.urlOrID.trim() : ''
  let externalID = raw
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) {
    let url
    try { url = new URL(raw) } catch { throw invalid('invalid_playlist_url') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw invalid('invalid_playlist_url')
    if (url.hostname === '163cn.tv') throw invalid('netease_playlist_full_url_required')
    if (!['music.163.com', 'y.music.163.com', 'm.music.163.com'].includes(url.hostname)) throw invalid('invalid_playlist_url')
    const page = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), 'https://music.163.com') : url
    if (!/^\/(?:m\/)?playlist\/?$/.test(page.pathname)) throw invalid('invalid_playlist_url')
    externalID = page.searchParams.get('id')
    if (!/^[1-9][0-9]{0,15}$/.test(externalID ?? '')) throw invalid('invalid_playlist_url')
  }
  const value = await catalogue.publicPlaylist(externalID)
  const trackIDs = [...new Set(value.trackIDs)]
  const name = nameOf(body.name || value.name)
  await ensureTracks(db, catalogue, trackIDs)
  const imported = await transaction(db, tx => createPlaylist(tx, owner, name, trackIDs))
  return { playlist: imported, imported: trackIDs.length, duplicatesSkipped: value.trackIDs.length - trackIDs.length, sourcePlaylistID: externalID }
}

export function limitOf(raw, fallback, max) {
  if (raw === null) return fallback
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw invalid('invalid_limit')
  return limit
}

async function recentSearches(db, owner, limit) {
  const { rows } = await db.query(`
    SELECT query, source, count, last_searched_at AS "lastSearchedAt" FROM music_search_history
    WHERE owner_id = $1 ORDER BY last_searched_at DESC, source, query_key LIMIT $2`, [owner, limit])
  return rows.map(row => ({ ...row, count: Number(row.count) }))
}

export async function searchHistoryRoute(db, owner, method, body, limit) {
  if (method === 'GET') return { searches: await recentSearches(db, owner, limit) }
  if (method === 'DELETE') {
    await db.query('DELETE FROM music_search_history WHERE owner_id = $1', [owner])
  } else if (method === 'POST') {
    const query = cleanQuery(body.query)
    const source = sourceID(body.source)
    await transaction(db, async tx => {
      await tx.query('SELECT id FROM music_users WHERE id = $1 FOR UPDATE', [owner])
      await tx.query(`
        INSERT INTO music_search_history(owner_id, source, query_key, query) VALUES ($1, $2, $3, $4)
        ON CONFLICT (owner_id, source, query_key)
        DO UPDATE SET count = music_search_history.count + 1, query = EXCLUDED.query, last_searched_at = now()`,
      [owner, source, query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '), query])
      await tx.query(`
        DELETE FROM music_search_history WHERE owner_id = $1 AND (source, query_key) IN (
          SELECT source, query_key FROM music_search_history WHERE owner_id = $1
          ORDER BY last_searched_at DESC, source, query_key OFFSET 200
        )`, [owner])
    })
  } else throw missing()
  return ok
}

export async function recommendations(db, catalogue, owner, params, key) {
  const limit = limitOf(params.get('limit'), 12, 50)
  const excludes = (params.get('exclude') || '').split(',').filter(Boolean)
  ids(excludes, 50)
  const [liked, history, searches] = await Promise.all([likes(db, owner), recentHistory(db, owner), recentSearches(db, owner, 1)])
  const seed = liked.find(item => item.artist) ?? history.find(item => item.track.artist)?.track
  const basis = seed ? (liked.includes(seed) ? 'likes' : 'history') : searches[0] ? 'search' : 'discovery'
  const skip = new Set([...excludes, ...liked.map(track => track.id), ...history.map(item => item.track.id)])
  const out = []
  const add = (track, basis, reason, association) => {
    if (skip.has(track.id) || out.length >= limit) return
    out.push({ track, basis, reason, ...(association ? { association } : {}) })
    skip.add(track.id)
  }
  const signals = AbortSignal.timeout(5500)
  const refresh = params.get('refresh') || ''
  const discovery = ['陈奕迅', 'Kevin MacLeod', 'The Beatles', '坂本龍一']
  const rotation = refresh ? [...refresh].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % discovery.length : 0
  const search = (q, source) => catalogue.search(q, source, signals)
  const discoverySearch = Promise.allSettled([
    search(discovery[rotation], 'netease'),
    search(discovery[(rotation + 1) % discovery.length], 'netease'),
  ])
  const own = seed ? search(seed.artist, seed.source) : searches[0] ? search(searches[0].query, searches[0].source) : Promise.resolve([])
  const [personal, related] = await Promise.all([
    own.catch(() => []),
    seed ? lastfmSimilar(key, seed, signals) : [],
  ])
  const relations = await Promise.allSettled(related.slice(0, 2).map(async relation => {
    const candidates = (await search(relation.title + ' ' + relation.artist, 'netease'))
      .filter(track => sameRecordingName(track, relation) && track.album && track.durationMs)
    if (candidates.length === 1 && !sameRecordingName(candidates[0], seed)) return { track: candidates[0], relation }
  }))
  for (const item of relations) {
    if (item.status !== 'fulfilled' || !item.value) continue
    const { track, relation } = item.value
    add(track, basis, '与这首歌相关的 Last.fm 推荐', {
      kind: 'similar_song', source: 'lastfm', seedTrackID: seed.id, ...(relation.match === undefined ? {} : { match: relation.match }),
    })
  }
  for (const track of personal.slice(0, Math.ceil(limit / 2))) {
    if (seed && !sameRecordingName({ title: seed.title, artist: track.artist }, seed)) continue
    const reason = { likes: '根据你喜欢的歌手', history: '根据最近播放的歌手', search: '根据你的主动搜索' }[basis]
    add(track, basis, reason)
  }
  const publicResults = await discoverySearch
  for (const item of publicResults) {
    if (item.status === 'fulfilled') for (const track of item.value) add(track, 'discovery', '公开曲库')
  }
  if (!out.length && publicResults.every(item => item.status === 'rejected')) {
    throw new ApiError(502, '推荐曲库暂不可用，请稍后重试。')
  }
  await saveTracks(db, out.map(item => item.track))
  return { tracks: out, personalized: out.some(item => item.basis !== 'discovery') }
}
