import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { createMusicHandler, prefix } from './music/handler.mjs'

const handleMusic = createMusicHandler(process.env, process.env.VERCEL_ENV || 'local')
const dist = resolve('dist')
const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon',
  woff2: 'font/woff2', json: 'application/json', txt: 'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path.startsWith(prefix + '/') || path === '/api/music') return handleMusic(req, res)
  try {
    const file = join(dist, decodeURIComponent(path))
    if (file !== dist && !file.startsWith(dist + sep)) throw new Error()
    const info = await stat(file).catch(() => null)
    const target = info?.isFile() ? file : join(dist, 'index.html')
    await stat(target)
    res.setHeader('Content-Type', types[target.split('.').pop()] ?? 'application/octet-stream')
    createReadStream(target).on('error', () => res.destroy()).pipe(res)
  } catch {
    res.statusCode = 404
    res.end('Page not found. Run npm run build to serve the web UI.')
  }
})
server.listen(Number(process.env.PORT || 37835), '127.0.0.1', () => {
  console.log('YesPlayMusic http://127.0.0.1:' + server.address().port)
})
