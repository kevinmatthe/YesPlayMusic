import { readFile } from 'node:fs/promises'
import { createPool, transaction } from './music/database.mjs'

const scope = process.env.MUSIC_DATABASE_SCOPE
if (!['local', 'preview', 'production'].includes(scope)) {
  console.error('Set MUSIC_DATABASE_SCOPE to local, preview or production.')
  process.exit(1)
}
const files = ['002-deployment-scope.sql', '001-music.sql']
const [guard, schema] = await Promise.all(files.map(file => readFile(new URL('./migrations/' + file, import.meta.url), 'utf8')))
let pool
try {
  pool = createPool(process.env.MUSIC_MIGRATION_DATABASE_URL, scope, 'yesplay-migration')
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('betago-music-schema-v1'))")
    await db.query(guard)
    await db.query('INSERT INTO music_deployment_scope(scope) VALUES ($1) ON CONFLICT DO NOTHING', [scope])
    const { rows: [row] } = await db.query('SELECT scope FROM music_deployment_scope WHERE singleton')
    if (row.scope !== scope) throw new Error('database_scope_mismatch')
    await db.query(schema)
  })
  console.log('Music schema ready for ' + scope)
} catch (error) {
  console.error('Music migration failed:', error.code ?? (error.message === 'database_scope_mismatch' ? error.message : 'database_unavailable'))
  process.exitCode = 1
} finally {
  await pool?.end()
}
