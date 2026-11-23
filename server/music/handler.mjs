import { createCatalogue } from './catalogue.mjs'
import { ApiError, createDatabase, invalid, missing } from './database.mjs'
import { accountAction, issueSession, session } from './identity.mjs'
import {
  cleanQuery, ensureTracks, exportLibrary, historyRoute, importLibrary, importPublicPlaylist,
  likeRoute, limitOf, playlistRoute, queueRoute, readShare, recommendations, saveTracks,
  searchHistoryRoute, shareRoute, sourceID,
} from './library.mjs'

export const prefix = '/music-api/v1'
const maxBody = 4 * 1024 * 1024

async function jsonBody(req) {
  if (Number(req.headers['content-length']) > maxBody) throw new ApiError(413, 'request_too_large')
  const method = req.method
  if (method === 'GET') return {}
  const parts = []
  let length = 0
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    length += part.length
    if (length > maxBody) throw new ApiError(413, 'request_too_large')
    parts.push(part)
  }
  if (!length) return {}
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new ApiError(415, 'json_required')
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString())
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error()
    return value
  } catch {
    throw invalid('invalid_json')
  }
}

function routeURL(req) {
  const url = new URL(req.url, 'http://music.invalid')
  if (url.pathname.startsWith(prefix + '/')) {
    return { path: url.pathname.slice(prefix.length + 1), params: url.searchParams }
  }
  // Vercel's internal rewrite can expose the function pathname and query.
  if (url.pathname === '/api/music') {
    const paths = url.searchParams.getAll('__music_route')
    if (paths.length === 1 && paths[0]) return { path: paths[0], params: url.searchParams }
  }
  throw missing()
}

function checkOrigin(req, scope) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new ApiError(405, 'method_not_allowed')
  const host = req.headers.host
  const local = scope === 'local' && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?$/.test(host ?? '')
  const origin = (local ? 'http://' : 'https://') + host
  if (req.headers.origin && req.headers.origin !== origin) throw new ApiError(403, 'origin_denied')
  if (req.method !== 'GET' && req.headers.origin === undefined && req.headers['x-music-delivery'] !== 'direct') {
    throw new ApiError(403, 'origin_denied')
  }
  // Host-only cookies on every deployment. Plain HTTP is only supported on loopback.
  return !local
}

export function createMusicHandler(env, scope) {
  const database = createDatabase(env, scope)
  const catalogue = createCatalogue(env)

  async function route(req, res) {
    const secure = checkOrigin(req, scope)
    const { path, params } = routeURL(req)
    const method = req.method
    let parts
    try {
      parts = path.split('/').map(decodeURIComponent)
    } catch {
      throw invalid('invalid_path')
    }
    if (parts.some(part => !part || part.length > 160 || /[\u0000-\u001f/\\]/.test(part))) throw missing()
    const key = parts.join('/')
    const [category, id, action] = parts
    const count = parts.length

    if (method === 'GET' && key === 'auth/options') return { guest: true, feishu: { enabled: false, appID: '' } }
    if (method === 'GET' && key === 'catalog/options') return catalogue.options
    if (method === 'POST' && ['auth/feishu/exchange', 'auth/feishu/profile'].includes(key)) {
      throw new ApiError(503, 'feishu_not_configured')
    }
    const db = await database()
    if (method === 'GET' && key === 'health') {
      await db.query('SELECT 1 FROM music_users LIMIT 0')
      return { status: 'ok', database: 'ready', scope, feishu: false, lastfm: !!env.MUSIC_LASTFM_API_KEY, unmKuwo: env.MUSIC_UNM_KUWO !== '0' }
    }
    if (method === 'POST' && ['auth/guest', 'auth/recover'].includes(key)) {
      return issueSession(db, req, res, secure, await jsonBody(req), id === 'recover')
    }
    if (category === 'shared' && count === 2 && method === 'GET') return readShare(db, catalogue, id)
    const account = await session(db, req)
    const owner = account.row.id
    const body = await jsonBody(req)
    if ((key === 'me' && method === 'GET') || (['auth/logout', 'auth/recovery'].includes(key) && method === 'POST')) {
      return accountAction(key, db, account, res, secure)
    }

    if (method === 'GET' && key === 'search') {
      const tracks = await catalogue.search(cleanQuery(params.get('q')), sourceID(params.get('source')))
      await saveTracks(db, tracks)
      return { tracks }
    }
    if (method === 'POST' && key === 'tracks/details') {
      return { tracks: await ensureTracks(db, catalogue, body.ids) }
    }
    if (method === 'POST' && key === 'tracks/register') {
      return (await ensureTracks(db, catalogue, [body.track?.id]))[0]
    }
    if (category === 'tracks' && count === 2 && method === 'GET') {
      return (await ensureTracks(db, catalogue, [id]))[0]
    }
    if (category === 'tracks' && count === 3) {
      if (action === 'resolve' && method === 'POST') {
        const delivery = body.delivery ?? req.headers['x-music-delivery']
        if (delivery !== 'direct') throw invalid('direct_delivery_required')
        const [track] = await ensureTracks(db, catalogue, [id])
        return catalogue.resolve(track)
      }
      if (action === 'lyrics' && method === 'GET') {
        const [track] = await ensureTracks(db, catalogue, [id])
        return catalogue.lyrics(track)
      }
    }
    if (count <= 2) {
      if (category === 'playlists') return playlistRoute(db, catalogue, owner, method, id, body)
      if (category === 'likes') return likeRoute(db, catalogue, owner, method, id)
      if (category === 'shares') return shareRoute(db, catalogue, owner, method, id, body)
      if (category === 'queue' && id) return queueRoute(db, catalogue, owner, method, id, body)
    }
    if (key === 'history') return historyRoute(db, catalogue, owner, method, body)
    if (key === 'search-history') return searchHistoryRoute(
      db, owner, method, body, method === 'GET' ? limitOf(params.get('limit'), 20, 100) : 20,
    )
    if (method === 'GET' && key === 'recommendations') {
      return recommendations(db, catalogue, owner, params, env.MUSIC_LASTFM_API_KEY)
    }
    if (method === 'GET' && key === 'export') return exportLibrary(db, owner)
    if (method === 'POST' && key === 'import') return importLibrary(db, catalogue, owner, body)
    if (method === 'POST' && key === 'imports/netease-playlist') return importPublicPlaylist(db, catalogue, owner, body)
    if (method === 'POST' && category === 'shared' && count === 3 && action === 'copy') {
      return importLibrary(db, catalogue, owner, await readShare(db, catalogue, id))
    }
    throw missing()
  }

  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const data = await route(req, res)
      res.statusCode = 200
      res.end(JSON.stringify(data))
    } catch (error) {
      if (error instanceof ApiError) {
        res.statusCode = error.status
        res.end(JSON.stringify({ error: error.code }))
        return
      }
      // No exception messages, queries, parameters, cookies or source URLs go to logs.
      const code = typeof error.code === 'string' && /^[A-Z0-9_]{2,35}$/.test(error.code) ? error.code : 'unexpected'
      console.warn('music_request_error', code)
      res.statusCode = 503
      res.end(JSON.stringify({ error: code === '42P01' ? 'database_migration_required' : 'music_service_unavailable' }))
    }
  }
}
