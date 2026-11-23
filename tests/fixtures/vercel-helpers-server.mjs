import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import handler from '../../api/music.mjs'

// Vercel helpers at f7b5377d, helpers.ts:262-289. Only the request body
// behavior is reproduced. Response helpers and the cloud runtime are absent.
const server = createServer(async (req, res) => {
  const chunks = []
  if (req.headers['content-type'] !== undefined) {
    for await (const chunk of req) chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (req.headers['content-type'] !== undefined) {
    const replay = new PassThrough()
    const on = replay.on.bind(replay)
    const originalOn = req.on.bind(req)
    req.read = replay.read.bind(replay)
    req.on = req.addListener = (name, listener) =>
      name === 'data' || name === 'end' ? on(name, listener) : originalOn(name, listener)
    replay.end(bytes)
  }
  Object.defineProperty(req, 'body', {
    get: () => req.headers['content-type']?.startsWith('application/json') && bytes.length
      ? JSON.parse(bytes.toString())
      : bytes,
  })
  return handler(req, res)
})

server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
