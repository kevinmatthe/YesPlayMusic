import pg from 'pg'

export class ApiError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

export const unavailable = () => new ApiError(502, '曲库暂不可用，请稍后重试。')
export const missing = () => new ApiError(404, 'not_found')
export const invalid = code => new ApiError(400, code)
export const conflict = () => new ApiError(409, 'revision_conflict')

export function connectionString(raw, scope) {
  if (!raw) throw new ApiError(503, 'database_not_configured')
  try {
    const url = new URL(raw)
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname
      || !url.pathname.slice(1) || url.hash) throw new Error()
    // pg also reads libpq-style parameters from the query string.
    const permitted = new Set(['sslmode', 'channel_binding'])
    if ([...url.searchParams.keys()].some(key => !permitted.has(key))) throw new Error()
    const local = scope === 'local' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (local && !url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'disable')
    if (!local) {
      const mode = url.searchParams.get('sslmode')
      if (mode && mode !== 'require' && mode !== 'verify-full') throw new Error()
      url.searchParams.set('sslmode', 'verify-full')
    }
    return url.href
  } catch {
    throw new ApiError(503, 'database_configuration_invalid')
  }
}

export function createPool(connection, scope, applicationName) {
  const pool = new pg.Pool({
    connectionString: connectionString(connection, scope),
    application_name: applicationName,
    max: 4,
    connectionTimeoutMillis: 4500,
    statement_timeout: 6000,
    idleTimeoutMillis: 5000,
    allowExitOnIdle: true,
  })
  pool.on('error', error => console.warn('music_database_idle_error', error.code ?? 'connection_failed'))
  return pool
}

export function createDatabase(env, scope) {
  let pool
  let checked
  return async () => {
    if (!['local', 'preview', 'production'].includes(scope)) {
      throw new ApiError(503, 'database_scope_missing')
    }
    const dsn = scope === 'preview' ? env.MUSIC_PREVIEW_DATABASE_URL : env.MUSIC_DATABASE_URL
    pool ??= createPool(dsn, scope, 'yesplay-music')
    checked ??= pool.query('SELECT scope FROM music_deployment_scope WHERE singleton')
      .then(({ rows: [row] }) => {
        if (row?.scope !== scope) throw new ApiError(503, 'database_scope_mismatch')
      }).catch(error => {
        checked = undefined
        if (error.code === '42P01') throw new ApiError(503, 'database_migration_required')
        throw error
      })
    await checked
    return pool
  }
}

export async function transaction(pool, action) {
  const db = await pool.connect()
  let discard
  try {
    await db.query('BEGIN')
    const result = await action(db)
    await db.query('COMMIT')
    return result
  } catch (error) {
    try {
      await db.query('ROLLBACK')
    } catch (rollbackError) {
      discard = rollbackError
    }
    throw error
  } finally {
    db.release(discard)
  }
}
