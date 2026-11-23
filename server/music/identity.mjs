import { createHash, randomBytes } from 'node:crypto'
import { ApiError, transaction } from './database.mjs'

export const secret = () => randomBytes(32).toString('base64url')
export const digest = value => createHash('sha256').update(value).digest('hex')
const credential = /^[A-Za-z0-9_-]{32,128}$/
const maxAge = 30 * 24 * 60 * 60
const cookieName = 'music_session'

function sessionToken(req) {
  const value = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    ?? req.headers.cookie?.split(/;\s*/).find(cookie => cookie.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  return typeof value === 'string' && credential.test(value) ? value : undefined
}

function setCookie(res, value, secure, age = maxAge) {
  const flags = 'Path=/music-api/v1; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '')
  res.setHeader('Set-Cookie', `${cookieName}=${value}; ${flags}; Max-Age=${age}`)
}

function publicSession(row) {
  return { user: { id: row.id, kind: row.kind }, expiresAt: row.expires_at }
}

export async function session(db, req, required = true) {
  const token = sessionToken(req)
  if (token) {
    const hash = digest(token)
    const { rows: [row] } = await db.query(`
      SELECT u.id, u.kind, s.expires_at FROM music_sessions s
      JOIN music_users u ON u.id = s.user_id WHERE s.hash = $1 AND expires_at > now()`, [hash])
    if (row) return { row, hash }
  }
  if (required) throw new ApiError(401, 'session_required')
}

export async function issueSession(pool, req, res, secure, body, recover) {
  const bearer = body.transport === 'bearer'
  if (!recover && !bearer) {
    const existing = await session(pool, req, false)
    if (existing) return publicSession(existing.row)
  }
  const token = secret()
  const row = await transaction(pool, async db => {
    let user
    if (recover) {
      if (typeof body.recoveryCode !== 'string' || !credential.test(body.recoveryCode)) {
        throw new ApiError(401, 'invalid_recovery_code')
      }
      const result = await db.query("SELECT id, kind FROM music_users WHERE recovery_hash = $1 AND kind = 'guest'", [digest(body.recoveryCode)])
      user = result.rows[0]
      if (!user) throw new ApiError(401, 'invalid_recovery_code')
    } else {
      const id = secret()
      const result = await db.query(`
        INSERT INTO music_users(id, kind, app_id, tenant_key, subject)
        VALUES ($1, 'guest', '', '', $1) RETURNING id, kind`, [id])
      user = result.rows[0]
    }
    const expiresAt = new Date(Date.now() + maxAge * 1000)
    await db.query('INSERT INTO music_sessions(hash, user_id, expires_at) VALUES ($1, $2, $3)', [digest(token), user.id, expiresAt])
    return { ...user, expires_at: expiresAt }
  })
  if (bearer) return { ...publicSession(row), token }
  setCookie(res, token, secure)
  return publicSession(row)
}

export async function accountAction(action, db, account, res, secure) {
  if (action === 'me') return publicSession(account.row)
  if (action === 'auth/logout') {
    await db.query('DELETE FROM music_sessions WHERE hash = $1', [account.hash])
    setCookie(res, '', secure, 0)
    return { ok: true }
  }
  if (account.row.kind !== 'guest') throw new ApiError(403, 'recovery_guest_only')
  const recoveryCode = secret()
  await db.query('UPDATE music_users SET recovery_hash = $1 WHERE id = $2', [digest(recoveryCode), account.row.id])
  return { recoveryCode }
}
