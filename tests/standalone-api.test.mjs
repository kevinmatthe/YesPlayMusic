import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { test } from 'node:test'

const env = { ...process.env, PORT: '0', VERCEL_ENV: 'local', MUSIC_DATABASE_URL: process.env.TEST_MUSIC_DATABASE_URL }
const track = 'netease:403711640'
const api = '/music-api/v1'

async function start(options = {}, helpers = false) {
  const entry = helpers ? 'tests/fixtures/vercel-helpers-server.mjs' : 'server/local.mjs'
  const child = spawn(process.execPath, [entry], { env: { ...env, ...options }, stdio: ['ignore', 'pipe', 'inherit'] })
  let stdout = ''
  const address = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => reject(new Error('local app exited: ' + code)))
    child.stdout.on('data', chunk => {
      stdout += chunk
      const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
      if (url) resolve(url)
    })
  })
  return {
    address,
    async stop() {
      child.kill()
      await once(child, 'exit')
    },
    async call(path, {
      method = 'GET', cookie, body, origin = address, status = 200,
      contentType = 'application/json', raw, chunks,
    } = {}) {
      const response = await fetch(address + api + path, {
        method,
        headers: {
          ...(origin ? { origin } : {}),
          ...(cookie ? { cookie } : {}),
          ...(method !== 'GET' ? { 'X-Music-Delivery': 'direct' } : {}),
          ...(method !== 'GET' && contentType ? { 'Content-Type': contentType } : {}),
        },
        ...(chunks ? { body: Readable.from(chunks), duplex: 'half' } : { body: raw ?? JSON.stringify(body) }),
      })
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(response.status, status, path)
      return { body: await response.json(), cookie: response.headers.get('set-cookie') }
    },
  }
}

test('Preview validates raw and Vercel replayed JSON bodies before connecting to Postgres', async t => {
  for (const helpers of [false, true]) {
    const app = await start({ VERCEL_ENV: 'preview', MUSIC_PREVIEW_DATABASE_URL: '' }, helpers)
    const recover = (status, fields) => app.call('/auth/recover', { method: 'POST', origin: null, status, ...fields })
    try {
      const { body } = await app.call('/catalog/options', { origin: null })
      assert.equal(body.defaultSource, 'netease')
      assert.equal((await app.call('/health', { origin: null, status: 503 })).body.error, 'database_not_configured')
      for (const invalid of ['{"recoveryCode":', '[]', 'null', '1', '"value"']) {
        assert.equal((await recover(400, { raw: invalid })).body.error, 'invalid_json')
      }
      assert.equal((await recover(415, { raw: '{}', contentType: 'text/plain' })).body.error, 'json_required')
      assert.equal((await recover(415, { chunks: [Buffer.from('{}')], contentType: null })).body.error, 'json_required')
      const max = 4 * 1024 * 1024
      const head = Buffer.from('{"value":"')
      const tail = Buffer.from('"}')
      const payload = Buffer.alloc(max - head.length - tail.length, 'a')
      assert.equal((await recover(503, { chunks: [head, payload, tail] })).body.error, 'database_not_configured')
      const tooLarge = Buffer.alloc(max + 1 - head.length - tail.length, 'a')
      assert.equal((await recover(413, { chunks: [head, tooLarge, tail] })).body.error, 'request_too_large')
      assert.equal((await recover(413, { raw: Buffer.concat([head, tooLarge, tail]) })).body.error, 'request_too_large')
      assert.equal((await recover(403, { raw: '{', origin: 'https://unrelated.example' })).body.error, 'origin_denied')
      t.diagnostic(`${helpers ? 'Vercel replay fixture' : 'raw IncomingMessage'}: malformed/non-object 400, invalid or missing content type 415, exact 4 MiB reaches DB, fixed-length and chunked overflow 413, foreign Origin 403`)
    } finally {
      await app.stop()
    }
  }
})

test('a Preview cannot use a database migrated for local or production', { skip: !env.MUSIC_DATABASE_URL }, async t => {
  const app = await start({ VERCEL_ENV: 'preview', MUSIC_PREVIEW_DATABASE_URL: env.MUSIC_DATABASE_URL })
  try {
    assert.equal((await app.call('/health', { origin: null, status: 503 })).body.error, 'database_scope_mismatch')
    t.diagnostic('TLS-enabled local PostgreSQL: Preview health returned 503 database_scope_mismatch')
  } finally {
    await app.stop()
  }
})

test('Vercel replayed writes and recovery persist in isolated Postgres across app processes', { skip: !env.MUSIC_DATABASE_URL }, async t => {
  let app = await start({}, true)
  const change = (cookie, method, body, status = 200) => ({ cookie, method, body, status })
  const cookieFor = async () => {
    const { cookie } = await app.call('/auth/guest', change(undefined, 'POST', {}))
    assert.match(cookie, /HttpOnly; SameSite=Lax/)
    return cookie.split(';')[0]
  }
  try {
    const alice = await cookieFor()
    const bob = await cookieFor()
    const { body: { recoveryCode } } = await app.call('/auth/recovery', change(alice, 'POST', {}))
    const { body: p } = await app.call('/playlists', change(alice, 'POST', { name: 'Test playlist', trackIDs: [track, track] }))
    const playlist = '/playlists/' + p.id
    assert.equal(p.tracks.length, 1)
    assert.equal(p.name, 'Test playlist')
    assert.deepEqual((await app.call(playlist, { cookie: alice })).body, p)
    const revisions = await Promise.all([200, 409].map(async (_, index) => {
      const response = await fetch(app.address + api + playlist, {
        method: 'PUT',
        headers: { cookie: alice, origin: app.address, 'X-Music-Delivery': 'direct', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: p.revision, name: 'Edit ' + index, trackIDs: [track] }),
      })
      return response.status
    }))
    assert.deepEqual(revisions.sort(), [200, 409])
    await app.call(playlist, { cookie: bob, status: 404 })
    await app.call('/likes/' + track, change(alice, 'PUT', {}))
    await app.call('/likes/' + track, change(alice, 'PUT', {}))
    await app.call('/history', change(alice, 'POST', { trackID: track, positionMs: 1500 }))
    await app.call('/search-history', change(alice, 'POST', { source: 'netease', query: 'Kevin MacLeod' }))
    const queue = { trackIDs: [track], currentIndex: 0, positionMs: 1500, revision: 0 }
    const { body: savedQueue } = await app.call('/queue/test-device', change(alice, 'PUT', queue))
    assert.deepEqual(savedQueue, { ...queue, revision: 1 })
    assert.deepEqual((await app.call('/queue/test-device', { cookie: alice })).body, savedQueue)
    await app.call('/queue/test-device', change(alice, 'PUT', queue, 409))
    const { body: share } = await app.call('/shares', change(alice, 'POST', { kind: 'playlist', targetID: p.id }))
    t.diagnostic('Vercel replay fixture: wrote and read playlist name/track and queue position/revision in PostgreSQL; stale revisions returned 409')
    const oldAddress = app.address
    await app.stop()
    app = await start({}, true)
    t.diagnostic(`Stopped first app process (${oldAddress}); started replacement app process (${app.address}) without restarting PostgreSQL`)
    const malformed = await app.call('/auth/recover', { method: 'POST', raw: '{"recoveryCode":', status: 400 })
    assert.equal(malformed.body.error, 'invalid_json')
    const recovered = await app.call('/auth/recover', change(undefined, 'POST', { recoveryCode }))
    const restored = recovered.cookie.split(';')[0]
    for (const cookie of [alice, restored]) {
      assert.equal((await app.call(playlist, { cookie })).body.revision, 2)
      assert.deepEqual((await app.call('/likes', { cookie })).body.tracks.map(t => t.id), [track])
      assert.equal((await app.call('/history', { cookie })).body.history[0].positionMs, 1500)
      assert.equal((await app.call('/search-history', { cookie })).body.searches[0].count, 1)
      assert.deepEqual((await app.call('/queue/test-device', { cookie })).body, { ...queue, revision: 1 })
    }
    assert.equal((await app.call('/queue/test-device', { cookie: bob })).body.revision, 0)
    assert.deepEqual((await app.call('/likes', { cookie: bob })).body.tracks, [])
    assert.deepEqual((await app.call('/history', { cookie: bob })).body.history, [])
    assert.deepEqual((await app.call('/search-history', { cookie: bob })).body.searches, [])
    assert.equal((await app.call('/shared/' + share.token)).body.playlists[0].tracks[0].id, track)
    await app.call('/shares/' + share.id, change(bob, 'DELETE', undefined, 404))
    await app.call('/shares/' + share.id, change(alice, 'DELETE'))
    await app.call('/shared/' + share.token, { status: 404 })
    const exported = (await app.call('/export', { cookie: alice })).body
    await app.call('/import', change(bob, 'POST', exported))
    assert.equal((await app.call('/playlists', { cookie: bob })).body.playlists[0].tracks[0].id, track)
    await app.call('/auth/logout', change(alice, 'POST', {}))
    await app.call('/me', { cookie: alice, status: 401 })
    t.diagnostic('Recovery 200, malformed recovery 400; read back playlist, likes, history, search history and queue with old and recovered sessions; verified owner isolation and logout')
  } finally {
    await app.stop()
  }
})
