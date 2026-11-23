import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCatalogue, selectUNMMatch } from '../server/music/catalogue.mjs'

test('UNM receives a unique edition with exact title, credits, album and bounded duration', () => {
  const seed = { id: 'netease:42', title: 'Song', artist: 'Artist, Guest', album: 'Album', durationMs: 225000 }
  const match = { ...seed, id: 'kuwo:100', source: 'kuwo', externalID: '100', artist: 'GUEST&ARTIST', durationMs: 224000 }
  const wrong = [
    { ...match, id: 'kuwo:101', title: 'Song (live)' },
    { ...match, id: 'kuwo:102', artist: 'Artist' },
    { ...match, id: 'kuwo:103', album: 'Other edition' },
    { ...match, id: 'kuwo:104', durationMs: 30000 },
  ]
  assert.equal(selectUNMMatch(seed, wrong), undefined)
  assert.equal(selectUNMMatch(seed, [...wrong, match])?.id, match.id)
  assert.equal(selectUNMMatch(seed, [match, { ...match, id: 'kuwo:105' }]), undefined)
})

test('Kuwo audio resolution fails closed on missing free-play permission', async t => {
  const track = { id: 'kuwo:42', source: 'kuwo', externalID: '42', title: 'Song', artist: 'Artist', album: 'Album', durationMs: 225000 }
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(new URL(url).hostname)
    return Response.json({ content: [{ musicpage: { abslist: [{
      MUSICRID: 'MUSIC_42', SONGNAME: 'Song', ARTIST: 'Artist', ALBUM: 'Album', DURATION: '225',
      fpay: '1', payInfo: { feeType: { song: '1', vip: '1' }, cannotOnlinePlay: '1', listen_fragment: '1' },
    }] } }] })
  })
  assert.deepEqual(await createCatalogue({}).resolve(track), {
    trackID: 'kuwo:42', delivery: 'direct', status: 'unavailable', reason: 'provider_preview_requires_official_player',
  })
  assert.deepEqual(requests, ['search.kuwo.cn'])
})
