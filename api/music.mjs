import { createMusicHandler } from '../server/music/handler.mjs'

export default createMusicHandler(process.env, process.env.VERCEL_ENV)
