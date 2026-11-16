/** Local UI acceptance. All API/audio is intercepted in memory; no live data writes.
 * Run against `npm run preview -- --host 127.0.0.1 --port 37841`.
 * PLAYWRIGHT_MODULE=/absolute/playwright-core/index.mjs MOTION_ARTIFACTS=/path node tools/motion-browser.mjs
 */
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/tmp/jellyfin-review-browser/node_modules/playwright-core/index.mjs').href)
const base = process.env.MOTION_BASE || 'http://127.0.0.1:37841'
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only a loopback preview is allowed')
const artifacts = resolve(process.env.MOTION_ARTIFACTS || 'artifacts/motion')
await mkdir(artifacts, { recursive: true })
const report = { base, scope: 'Local production build, in-memory sample API and generated WAV; no live source/session writes', checks: [], errors: [], requestsOutsidePreview: [] }
function check(name, value = true, detail = {}) {
  assert(value, name)
  report.checks.push({ name, passed: true, ...detail })
  console.log('PASS ' + name)
}
const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `netease:${90000001 + i}`, externalID: String(90000001 + i), source: 'netease', title: ['清晨，慢一点', '午后的一束光', '夜行 · 轻呼吸'][i % 3] + (i > 2 ? ` ${i + 1}` : ''), artist: 'BetaGo 动效演示', album: '本地示例 / 非真实曲库', picture: '', durationMs: 120000 }))
const playlists = [{ id: 'motion-long', name: '日常节奏 · 300 首', revision: 1, tracks }, { id: 'motion-small', name: '慢下来，听一会儿', revision: 1, tracks: tracks.slice(0, 12) }]
function wav() {
  const rate = 8000, n = rate * 120, bytes = Buffer.alloc(44 + n * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.sin(i * Math.PI * 2 * 220 / rate) * 150, 44 + i * 2)
  return bytes
}
const tone = wav()
// Satisfy the public direct-URL contract without making a real CDN request.
// This response is generated WAV for visual tests only.
const demoAudioURL = 'https://m701.music.126.net/betago-motion-demo.wav'
report.mockAudio = 'Designated HTTPS CDN-shaped URL intercepted in memory with generated WAV; no real audio/source acceptance'
async function mock(context) {
  let likes = tracks.slice(0, 4), queue = { revision: 1, trackIDs: [], currentIndex: 0, positionMs: 0 }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.href === demoAudioURL) return route.fulfill({ contentType: 'audio/wav', body: tone })
    if (url.origin !== new URL(base).origin) {
      report.requestsOutsidePreview.push(url.origin)
      return route.abort()
    }
    if (url.pathname === '/motion-tone.wav') return route.fulfill({ contentType: 'audio/wav', body: tone })
    if (!url.pathname.startsWith('/music-api/v1/')) return route.continue()
    const path = decodeURIComponent(url.pathname.slice('/music-api/v1'.length)), method = request.method()
    let body = {}
    if (path === '/auth/options') body = { guest: true, feishu: { enabled: false, appID: '' } }
    else if (path === '/me' || path === '/auth/guest') body = { user: { id: 'local-motion-preview', kind: 'guest' }, expiresAt: '2099-01-01T00:00:00Z' }
    else if (path.startsWith('/queue/')) { if (method === 'PUT') queue = { ...request.postDataJSON(), revision: queue.revision + 1 }; body = queue }
    else if (path === '/playlists') body = { playlists }
    else if (path === '/likes') body = { tracks: likes }
    else if (path.startsWith('/likes/')) { const id = path.slice('/likes/'.length); likes = method === 'DELETE' ? likes.filter(t => t.id !== id) : [...likes, tracks.find(t => t.id === id)] }
    else if (path === '/history') body = { history: tracks.slice(0, 4).map(track => ({ track, positionMs: 0, playedAt: '2026-11-16T00:00:00Z' })) }
    else if (path === '/shares') body = { shares: [] }
    else if (path === '/catalog/options') body = { defaultSource: 'netease', sources: [{ id: 'netease', name: '网易云' }] }
    else if (path === '/search') body = { tracks: tracks.slice(0, 12) }
    else if (path === '/search-history') body = { searches: [{ query: '清晨', source: 'netease', count: 1, lastSearchedAt: '2026-11-16T00:00:00Z' }] }
    else if (path === '/recommendations') body = { personalized: false, tracks: tracks.slice(0, 4).map(track => ({ track, reason: '本地动效演示', basis: 'discovery' })) }
    else if (path === '/tracks/details') body = { tracks: request.postDataJSON().ids.map(id => tracks.find(t => t.id === id)) }
    else if (path.endsWith('/resolve')) body = { delivery: 'direct', trackID: path.split('/')[2], status: 'available', url: demoAudioURL, expiresAt: '2099-01-01T00:00:00Z' }
    else if (path.endsWith('/lyrics')) body = { trackID: path.split('/')[2], lrc: '[00:00]这是本地动效演示\n[00:03]慢下来，听一会儿\n[00:08]保留此刻的节奏\n[00:15]下一首，依然轻柔', translatedLrc: '' }
    else throw new Error('Unhandled sample API: ' + method + ' ' + path)
    await route.fulfill({ json: body })
  })
}

const browser = await chromium.launch({ executablePath: process.env.MOTION_CHROME || '/mnt/RapidPool/userspace/kevinmatt/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-proxy-server'] })
async function setup(options = {}) {
  const context = await browser.newContext(options)
  await mock(context)
  const page = await context.newPage()
  const staticReads = []
  if (process.env.MOTION_BACKGROUND === '1') {
    report.loadedStaticArtifacts = []
    page.on('response', response => {
      if (['document', 'script', 'stylesheet'].includes(response.request().resourceType())) staticReads.push((async () => {
        const bytes = await response.body()
        report.loadedStaticArtifacts.push({ path: new URL(response.url()).pathname, status: response.status(), sha256: createHash('sha256').update(bytes).digest('hex') })
      })())
    })
  }
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  await page.goto(base + '/library')
  await page.locator('.playlist-card').first().waitFor()
  await page.waitForTimeout(400)
  await Promise.all(staticReads)
  return { context, page }
}
const audio = page => page.locator('audio').evaluate(a => ({ time: a.currentTime, paused: a.paused, count: document.querySelectorAll('audio').length }))
const loops = page => page.evaluate(() => document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity).map(a => ({ name: a.animationName, state: a.playState })))

function requireRunningForeground(snapshot) {
  assert(snapshot.loopCount > 0, 'Foreground loop set must be nonempty')
  assert.equal(snapshot.hidden, false, 'Foreground document must be visible')
  assert.equal(snapshot.playing, true, 'Audio must be playing before the visibility change')
  assert.equal(snapshot.path, '/play')
  assert.equal(snapshot.current.filter(a => a.name === 'bars' && a.target.startsWith('.listening-bars')).length, 3)
  assert.equal(snapshot.current.filter(a => a.name === 'cover-breathe' && a.target === '.now-cover-shadow').length, 1)
  assert(snapshot.current.every(a => a.state === 'running'), 'All captured foreground loops must be running')
}

async function proveBackground(page, testEmptyGuard = false) {
  const proof = report.backgroundProof = { method: 'document.hidden + visibilitychange simulation; not a physical phone background/lock-screen test' }
  // Wait for audio events, Vue classes, IntersectionObserver and actual CSS animations.
  const waitForPlayingLoops = () => page.waitForFunction(() => {
    const active = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && a.playState === 'running' && !a.pending && a.currentTime > 0)
    return !document.hidden && !document.documentElement.hasAttribute('data-motion-paused') &&
      !document.querySelector('audio').paused && document.querySelector('.app-shell.is-playing') &&
      active.filter(a => a.animationName === 'bars' && a.effect.target.matches('.listening-bars i')).length === 3 &&
      active.some(a => a.animationName === 'cover-breathe' && a.effect.target.matches('.now-cover-shadow'))
  }, null, { polling: 50 })
  await waitForPlayingLoops()
  const retained = await page.evaluateHandle(() => document.getAnimations()
    .filter(a => a.effect?.getTiming().iterations === Infinity)
    .map((animation, index) => {
      const target = animation.effect.target
      const record = { animation, id: `original-${index + 1}`, name: animation.animationName, element: target,
        target: target.matches('.listening-bars i') ? `.listening-bars i:nth-child(${[...target.parentElement.children].indexOf(target) + 1})` : (target.classList.length ? '.' + [...target.classList].join('.') : target.tagName.toLowerCase()), cancelledEvent: false }
      record.listener = () => { record.cancelledEvent = true }
      animation.addEventListener('cancel', record.listener)
      return record
    }))
  const snapshot = () => retained.evaluate(records => {
    const current = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity)
    const describe = a => ({ name: a.animationName, state: a.playState, pending: a.pending,
      target: a.effect.target.matches('.listening-bars i') ? `.listening-bars i:nth-child(${[...a.effect.target.parentElement.children].indexOf(a.effect.target) + 1})` : (a.effect.target.classList.length ? '.' + [...a.effect.target.classList].join('.') : a.effect.target.tagName.toLowerCase()) })
    return { hidden: document.hidden, path: location.pathname, playing: !document.querySelector('audio').paused,
      rootMotionPaused: document.documentElement.hasAttribute('data-motion-paused'), loopCount: current.length,
      runningCount: current.filter(a => a.playState === 'running').length,
      current: current.map(a => ({ ...describe(a), sameAsBefore: records.some(r => r.animation === a) })),
      originals: records.map(r => ({ id: r.id, name: r.name, target: r.target, targetConnected: r.element.isConnected,
        state: r.animation.playState, pending: r.animation.pending, currentTime: r.animation.currentTime,
        enumerated: current.includes(r.animation), cancelledEvent: r.cancelledEvent,
        outcome: r.animation.playState === 'paused' ? 'paused' : r.animation.playState === 'idle' && !current.includes(r.animation) ? 'cancelled' : 'running-or-unexpected' })) }
  })
  const hiddenDescriptor = await page.evaluateHandle(() => Object.getOwnPropertyDescriptor(document, 'hidden'))
  try {
    if (testEmptyGuard) {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getTiming().iterations !== Infinity), null, { polling: 50 })
      const empty = await snapshot()
      assert.equal(empty.loopCount, 0, 'Negative control must actually have no loops')
      assert.throws(() => requireRunningForeground(empty), /must be nonempty/)
      proof.emptySetNegativeControl = { loopCount: empty.loopCount, rejected: true, reason: 'Foreground loop set must be nonempty' }
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await waitForPlayingLoops()
      // The negative control cancelled its original objects; retain the new running set.
      await retained.evaluate(records => {
        records.forEach(r => r.animation.removeEventListener('cancel', r.listener))
        document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity).forEach((animation, i) => {
          const r = records[i]; r.animation = animation; r.name = animation.animationName; r.element = animation.effect.target; r.cancelledEvent = false
          r.target = r.element.matches('.listening-bars i') ? `.listening-bars i:nth-child(${[...r.element.parentElement.children].indexOf(r.element) + 1})` : (r.element.classList.length ? '.' + [...r.element.classList].join('.') : r.element.tagName.toLowerCase())
          animation.addEventListener('cancel', r.listener)
        })
      })
    }
    proof.before = await snapshot()
    requireRunningForeground(proof.before)
    assert.equal(proof.before.originals.length, proof.before.loopCount)
    assert(proof.before.originals.every(a => a.state === 'running' && !a.pending && a.currentTime > 0 && a.enumerated && a.targetConnected), 'Every original must be a connected running foreground object with elapsed time')
    check('background proof starts with 3 running bars and 1 running cover loop', true, { count: proof.before.loopCount })
    await shot(page, 'background-before')
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForFunction(records => {
      const current = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity)
      return document.hidden && document.documentElement.hasAttribute('data-motion-paused') && records.length > 0 &&
        records.every(r => r.element.isConnected && ((r.animation.playState === 'paused' && !r.animation.pending) || (r.animation.playState === 'idle' && !current.includes(r.animation)))) &&
        !current.some(a => a.playState === 'running')
    }, retained, { polling: 50 })
    proof.after = await snapshot()
    await page.waitForTimeout(150)
    proof.afterSettled = await snapshot()
    assert.equal(proof.afterSettled.originals.length, proof.before.loopCount)
    assert(proof.afterSettled.originals.every((a, i) => a.targetConnected && ['paused', 'cancelled'].includes(a.outcome) &&
      (a.outcome === 'cancelled' || a.currentTime === proof.after.originals[i].currentTime)), 'Every retained original must stop advancing or be cancelled')
    assert.equal(proof.afterSettled.playing, true)
    assert.equal(proof.afterSettled.path, '/play')
    assert.equal(proof.afterSettled.runningCount, 0)
    check('background originals pause or cancel and no current loop runs', true, { originals: proof.afterSettled.originals.length, currentRunning: proof.afterSettled.runningCount })
    await shot(page, 'background-after')
    await hiddenDescriptor.evaluate(descriptor => { if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
    await waitForPlayingLoops()
    proof.restored = await snapshot()
    requireRunningForeground(proof.restored)
    check('foreground restores all 3 bars and the cover loop', true, { count: proof.restored.loopCount })
    return proof
  } finally {
    await hiddenDescriptor.evaluate(descriptor => { if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
    await retained.evaluate(records => records.forEach(r => r.animation.removeEventListener('cancel', r.listener)))
    await retained.dispose()
    await hiddenDescriptor.dispose()
  }
}
async function nav(page, path, mobile = false) {
  await page.locator(`${mobile ? '.mobile-nav' : '.main-nav'} a[href="${path}"]`).first().click()
  await page.waitForURL('**' + path)
}
const shot = (page, name) => page.screenshot({ path: resolve(artifacts, name + '.png') })

try {
 if (process.env.MOTION_BACKGROUND === '1') {
  const {context,page} = await setup({viewport:{width:1440,height:960}})
  await page.locator('.sidebar-playlists button').first().click()
  await page.locator('.track-row').first().locator('.track-info').click()
  await page.locator('.listening-link').click()
  await page.evaluate(() => scrollTo(0, 0))
  await proveBackground(page, true)
  check('targeted proof has no browser errors or unhandled external requests', report.errors.length === 0 && report.requestsOutsidePreview.length === 0)
  await context.close()
 } else if (process.env.MOTION_PERF === '1') {
  const {context,page} = await setup({viewport:{width:1440,height:960}})
  await page.locator('.sidebar-playlists button').first().click()
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 300)
  await page.locator('.track-row').first().locator('.track-info').click()
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .25)
  await page.waitForTimeout(600)
  report.scrollPerformance = await page.evaluate(async () => {
    const frames=[];let last=performance.now()
    for(let i=0;i<120;i++){window.scrollBy(0,85);await new Promise(requestAnimationFrame);const now=performance.now();if(i>=10)frames.push(now-last);last=now}
    const sorted=[...frames].sort((a,b)=>a-b)
    return {recordVideo:false,samples:frames.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],worstMs:sorted.at(-1),audioPlaying:!document.querySelector('audio').paused,rows:document.querySelectorAll('.track-row').length}
  })
  check('performance sample: 300 rows preserve playback without video overhead',report.scrollPerformance.audioPlaying,{...report.scrollPerformance})
  await context.close()
 } else {
  const { context, page } = await setup({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: artifacts, size: { width: 1440, height: 960 } } })
  const video = page.video()
  await shot(page, 'desktop-normal')
  await page.locator('.playlist-card').first().hover()
  await page.waitForTimeout(350)
  await shot(page, 'desktop-card-hover')
  check('desktop playlist hover reveals play affordance', await page.locator('.playlist-card-play').first().evaluate(e => getComputedStyle(e).opacity === '1'))
  await nav(page, '/search')
  await page.keyboard.press('Tab')
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).focus()
  await page.waitForTimeout(200)
  await shot(page, 'desktop-search-focus')
  check('programmatic search focus-visible style is visible (not full Tab navigation)', await page.locator('.search-box input').evaluate(e => e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'))
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('清晨')
  await page.locator('.search-box .primary').click()
  await page.locator('.track-row').first().waitFor()
  await page.locator('.track-row').first().hover()
  await shot(page, 'desktop-row-hover')
  await page.locator('.search-box .primary').hover()
  await page.mouse.down()
  await page.waitForTimeout(150)
  await shot(page, 'desktop-button-pressed')
  check('button press feedback uses transform without layout changes', await page.locator('.search-box .primary').evaluate(e => getComputedStyle(e).transform !== 'none'))
  await page.mouse.move(0,0)
  await page.mouse.up()
  const row = page.locator('.track-row').first()
  const originalTop = await row.evaluate(e => e.offsetTop)
  await row.locator('.track-info').focus()
  check('row hover/focus never changes row geometry', await row.evaluate(e => e.offsetTop) === originalTop)
  await row.locator('.track-info').click()
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .25)
  const node = await page.locator('audio').elementHandle()
  const before = await audio(page)
  await nav(page, '/library')
  await page.locator('.sidebar-playlists button').first().click()
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 300)
  const metric = await page.locator('.track-row').nth(150).evaluate(e => ({ top: e.offsetTop, height: e.offsetHeight }))
  const frames = await page.evaluate(async () => {
    const delta = []; let last = performance.now()
    for (let i = 0; i < 45; i++) { window.scrollBy(0, 115); await new Promise(requestAnimationFrame); const now = performance.now(); delta.push(now - last); last = now }
    return delta
  })
  check('300 row continuous scroll preserves exact row geometry', JSON.stringify(metric) === JSON.stringify(await page.locator('.track-row').nth(150).evaluate(e => ({ top: e.offsetTop, height: e.offsetHeight }))))
  check('300 rows have no persistent animation', await page.locator('.track-row').evaluateAll(rows => rows.every(r => r.getAnimations({ subtree: true }).every(a => a.effect?.getTiming().iterations !== Infinity))))
  check('sticky header gains scroll depth', await page.locator('.topbar').evaluate(e => e.classList.contains('is-scrolled') && e.getBoundingClientRect().top === 0))
  await shot(page, 'desktop-long-scroll')
  const after = await audio(page)
  check('navigation and continuous scroll preserve audio node and playback', await node.evaluate(a => a === document.querySelector('audio')) && !after.paused && after.time > before.time, { before, after, scrollFrames: frames.length, p95FrameMs: [...frames].sort((a,b)=>a-b)[Math.floor(frames.length*.95)] })
  await page.locator('.listening-link').click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  check('playing cover breath active only in viewport', await page.locator('.now-cover-shadow').evaluate(e => getComputedStyle(e).animationName === 'cover-breathe'))
  await shot(page, 'desktop-playing')
  await page.waitForTimeout(1400)
  await page.locator('.player-dock button[aria-label="暂停"]').click()
  check('pause stops cover breath', await page.locator('.now-cover-shadow').evaluate(e => getComputedStyle(e).animationName === 'none'))
  await shot(page, 'desktop-paused')
  await page.keyboard.press('Tab')
  await page.locator('.dock-progress input').focus()
  await shot(page, 'desktop-progress-focus')
  check('transparent progress input has visible focus on its wrapper', await page.locator('.dock-progress').evaluate(e => e.matches(':focus-within') && getComputedStyle(e).outlineStyle === 'solid'))
  await page.locator('.player-dock button[aria-label="播放"]').click()
  await proveBackground(page)
  await page.locator('.now-information button').filter({ hasText: '打开歌词' }).click()
  await page.locator('.lyrics-screen').waitFor()
  await page.waitForTimeout(300)
  await shot(page, 'desktop-lyrics')
  await page.locator('.lyrics-close').click()
  await page.locator('.sidebar-label button').click()
  await page.waitForTimeout(280)
  await shot(page, 'desktop-dialog-focus')
  check('dialog autofocus remains visible after entry', await page.locator('#playlist-name').evaluate(e => e === document.activeElement && getComputedStyle(e).opacity === '1'))
  await page.locator('.dialog-close').click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(200)
  check('runtime reduced-motion disables all loops', (await loops(page)).length === 0)
  await page.locator('.now-information button').filter({ hasText: '打开歌词' }).click()
  await page.evaluate(() => { window.__scrollBehavior = []; const old = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function(options) { window.__scrollBehavior.push(options?.behavior); return old.call(this,options) } })
  await page.locator('.lyric-line').nth(2).click()
  await page.waitForTimeout(350)
  check('reduced-motion lyric seek uses immediate scroll', await page.evaluate(() => window.__scrollBehavior.length > 0 && window.__scrollBehavior.every(v => v === 'auto')))
  await shot(page, 'desktop-reduced-motion')
  await context.close()
  await rename(await video.path(), resolve(artifacts, 'desktop-demo.webm'))

  const { context: mobileContext, page: mobile } = await setup({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, recordVideo: { dir: artifacts, size: { width: 375, height: 812 } } })
  const mobileVideo = mobile.video()
  check('375px touch cards expose controls without hover', await mobile.locator('.playlist-card-play').first().evaluate(e => getComputedStyle(e).opacity === '1'))
  await shot(mobile, 'mobile-375-library')
  await mobile.locator('.playlist-card').first().tap()
  await mobile.waitForFunction(() => document.querySelectorAll('.track-row').length === 300)
  check('375px long playlist has no horizontal overflow', await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  check('375px touch song controls remain visible and usable', await mobile.locator('.track-actions button').first().evaluate(e => { const b=e.getBoundingClientRect();return b.width>=36&&b.height>=44&&getComputedStyle(e).visibility==='visible' }))
  await mobile.locator('.track-row').first().locator('.track-info').tap()
  await mobile.waitForFunction(() => document.querySelector('audio').currentTime > .25)
  await shot(mobile, 'mobile-375-playing-list')
  const mobileNode = await mobile.locator('audio').elementHandle(), initial = await audio(mobile)
  await mobile.evaluate(async () => { for(let i=0;i<25;i++){scrollBy(0,110);await new Promise(requestAnimationFrame)} })
  await nav(mobile, '/likes', true)
  await nav(mobile, '/queue', true)
  await mobile.locator('.dock-track-name').tap()
  await mobile.evaluate(() => scrollTo(0, 0))
  await mobile.waitForTimeout(400)
  await shot(mobile, 'mobile-375-player')
  const later = await audio(mobile)
  check('375px repeated scroll/list switching does not interrupt playback', await mobileNode.evaluate(a => a===document.querySelector('audio')) && !later.paused && later.time>initial.time, { initial, later })
  await mobile.evaluate(() => scrollTo(0, document.body.scrollHeight))
  await mobile.waitForTimeout(150)
  check('offscreen cover stops breathing', await mobile.locator('.now-cover-shadow').evaluate(e => !e.parentElement.hasAttribute('data-motion-visible') && getComputedStyle(e).animationName === 'none'))
  await nav(mobile, '/search', true)
  await mobile.getByRole('textbox', { name: '搜索歌曲', exact: true }).tap()
  await mobile.waitForTimeout(220)
  check('375px search remains in viewport and avoids input zoom', await mobile.locator('.search-box input').evaluate(e => {const b=e.getBoundingClientRect();return parseInt(getComputedStyle(e).fontSize)>=16&&b.left>=0&&b.right<=innerWidth}))
  await shot(mobile, 'mobile-375-search-focus')
  await mobile.emulateMedia({reducedMotion:'reduce'})
  await nav(mobile, '/library', true)
  await mobile.locator('.playlist-card').first().waitFor()
  const card=mobile.locator('.playlist-card').first()
  await card.dispatchEvent('touchstart')
  check('375px reduced-motion disables loops and card movement', (await loops(mobile)).length===0 && await card.locator('img').evaluate(e=>getComputedStyle(e).transform==='none'))
  await shot(mobile, 'mobile-375-reduced-motion')
  await mobileContext.close()
  await rename(await mobileVideo.path(), resolve(artifacts, 'mobile-demo.webm'))
  check('no new browser console/runtime errors', report.errors.length === 0, { errors: report.errors })
  check('all visual-test requests were fulfilled locally without unexpected network access', report.requestsOutsidePreview.length === 0)
 }
} catch (error) {
  report.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(resolve(artifacts, process.env.MOTION_BACKGROUND==='1'?'background-results.json':process.env.MOTION_PERF==='1'?'performance-results.json':'browser-results.json'), JSON.stringify(report, null, 2) + '\n')
}
