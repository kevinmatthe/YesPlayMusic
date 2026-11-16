import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createBrowserThemeEnvironment, createThemeController, THEME_STORAGE_KEY, type ThemeEnvironment, type ThemeSnapshot } from '../src/theme'

function environment(preference: unknown = null, dark = false) {
  let stored = preference
  let systemDark = dark
  const systems = new Set<(value: boolean) => void>()
  const storage = new Set<(key: string | null, value: string | null) => void>()
  const applied: ThemeSnapshot[] = []
  const writes: string[] = []
  const env: ThemeEnvironment = {
    read: () => stored,
    write: mode => { stored = mode; writes.push(mode) },
    prefersDark: () => systemDark,
    watchSystem: listener => { systems.add(listener); return () => systems.delete(listener) },
    watchStorage: listener => { storage.add(listener); return () => storage.delete(listener) },
    apply: state => applied.push(state),
  }
  return {
    env, applied, writes, systems, storage,
    system(value: boolean) { systemDark = value; systems.forEach(listener => listener(value)) },
    external(key: string | null, value: string | null) {
      if (key === THEME_STORAGE_KEY || key === null) stored = value
      storage.forEach(listener => listener(key, value))
    },
    store(value: unknown) { stored = value },
    stored: () => stored,
    notify(key: string | null, value: string | null) { storage.forEach(listener => listener(key, value)) },
  }
}

describe('device theme preference', () => {
  it.each([false, true])('defaults to the current system appearance (dark=%s)', dark => {
    const host = environment(null, dark)
    const theme = createThemeController(host.env)
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: dark ? 'dark' : 'light' })
    expect(host.applied.at(-1)).toEqual(theme.snapshot())
    expect(host.writes).toEqual([])
  })

  it.each(['light', 'dark'] as const)('honors saved %s even when the system disagrees', mode => {
    const host = environment(mode, mode === 'light')
    const theme = createThemeController(host.env)
    expect(theme.snapshot()).toEqual({ mode, resolved: mode })
  })

  it('saves a manual choice, ignores OS changes, and resumes live OS changes in system mode', () => {
    const host = environment(null, false)
    const theme = createThemeController(host.env)
    theme.setMode('dark')
    host.system(true); host.system(false)
    expect(theme.snapshot()).toEqual({ mode: 'dark', resolved: 'dark' })
    theme.setMode('system')
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: 'light' })
    host.system(true)
    expect(theme.snapshot().resolved).toBe('dark')
    expect(host.writes).toEqual(['dark', 'system'])
  })

  it('treats corrupt preference as system and stays interactive when storage is blocked', () => {
    const host = environment('DARK', true)
    const initial = createThemeController(host.env)
    expect(initial.snapshot()).toEqual({ mode: 'system', resolved: 'dark' })
    initial.dispose()
    host.env.read = () => { throw new Error('blocked storage') }
    host.env.write = () => { throw new Error('quota / blocked storage') }
    const theme = createThemeController(host.env)
    theme.setMode('light')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
    host.system(true)
    expect(theme.snapshot().resolved).toBe('light')
  })

  it('synchronizes another tab without echo writes and resets to system on removal or clear', () => {
    const host = environment(null, true)
    const theme = createThemeController(host.env)
    host.external('someone-else', 'light')
    expect(theme.snapshot().mode).toBe('system')
    host.external(THEME_STORAGE_KEY, 'light')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
    host.external(THEME_STORAGE_KEY, null)
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: 'dark' })
    host.external(THEME_STORAGE_KEY, 'dark')
    host.external(null, null)
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: 'dark' })
    expect(host.writes).toEqual([])
  })

  it('notifies subscribers with snapshots, unsubscribes, and releases all event listeners', () => {
    const host = environment()
    const theme = createThemeController(host.env)
    const seen: ThemeSnapshot[] = []
    const off = theme.subscribe(state => seen.push(state))
    theme.setMode('dark')
    expect(seen).toEqual([{ mode: 'system', resolved: 'light' }, { mode: 'dark', resolved: 'dark' }])
    off(); theme.setMode('light')
    expect(seen).toHaveLength(2)
    theme.dispose(); theme.dispose()
    expect(host.systems.size + host.storage.size).toBe(0)
    host.system(true); host.external(THEME_STORAGE_KEY, 'dark'); theme.setMode('dark')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
  })

  it.each([
    [THEME_STORAGE_KEY, 'dark'],
    [null, null],
  ] as const)('does not let a queued storage notification overwrite a newer local choice (key=%s)', (key, oldValue) => {
    const host = environment(null, false)
    const theme = createThemeController(host.env)
    // Another tab changes shared storage, but delivery of its event is delayed.
    host.store(oldValue)
    // This tab makes a newer choice before the older notification is delivered.
    theme.setMode('light')
    host.notify(key, oldValue)
    expect(host.stored()).toBe('light')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
    expect(host.writes).toEqual(['light'])
    theme.dispose()
  })

  it('keeps the current in-memory choice if storage cannot confirm a queued notification', () => {
    const host = environment(null, false)
    const theme = createThemeController(host.env)
    theme.setMode('light')
    host.env.read = () => { throw new Error('storage access revoked') }
    host.notify(THEME_STORAGE_KEY, 'dark')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
    expect(host.writes).toEqual(['light'])
    theme.dispose()
  })
})

describe('browser appearance adapter', () => {
  function browserHost() {
    const values = new Map<string, string>()
    const writes: [string, string][] = []
    const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push([key, value]); values.set(key, value) } }
    const media = Object.assign(new EventTarget(), { matches: false })
    const events = new EventTarget()
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
    const metas = new Map<string, string>()
    const browser = Object.assign(events, { localStorage, matchMedia: () => media }) as unknown as Window
    const document = {
      documentElement: root,
      querySelector: (selector: string) => ({ setAttribute: (_: string, value: string) => metas.set(selector, value) }),
    } as unknown as Document
    return { browser, document, localStorage, media, events, root, metas, values, writes }
  }

  it('updates the root, browser chrome metadata, and stored choice through browser APIs', () => {
    const host = browserHost()
    const theme = createThemeController(createBrowserThemeEnvironment(host.browser, host.document))
    theme.setMode('dark')
    expect(host.root.dataset).toEqual({ theme: 'dark', themeMode: 'dark' })
    expect(host.root.style).toEqual({ colorScheme: 'dark', backgroundColor: '#111c17' })
    expect(host.metas.get('meta[name="theme-color"]')).toBe('#111c17')
    expect(host.metas.get('meta[name="color-scheme"]')).toBe('dark')
    expect(host.values.get(THEME_STORAGE_KEY)).toBe('dark')
    theme.setMode('system')
    host.media.matches = true
    host.media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: 'dark' })
    theme.dispose()
  })

  it('responds to localStorage events but does not consume unrelated sessionStorage events', () => {
    const host = browserHost()
    const theme = createThemeController(createBrowserThemeEnvironment(host.browser, host.document))
    host.events.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_STORAGE_KEY, newValue: 'dark', storageArea: {} }))
    expect(theme.snapshot().resolved).toBe('light')
    host.values.set(THEME_STORAGE_KEY, 'dark')
    host.events.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_STORAGE_KEY, newValue: 'dark', storageArea: host.localStorage }))
    expect(theme.snapshot().resolved).toBe('dark')
    expect(host.values.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(host.writes).toEqual([])
    theme.dispose()
    host.values.set(THEME_STORAGE_KEY, 'light')
    host.events.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_STORAGE_KEY, newValue: 'light', storageArea: host.localStorage }))
    expect(host.root.dataset.theme).toBe('dark')
  })

  it('keeps manual selection usable in an embedded browser exposing only a static media preference', () => {
    const host = browserHost()
    Object.defineProperty(host.browser, 'matchMedia', { value: () => ({ matches: true }) })
    Object.defineProperty(host.browser, 'localStorage', { get() { throw new Error('storage disabled') } })
    const theme = createThemeController(createBrowserThemeEnvironment(host.browser, host.document))
    expect(theme.snapshot()).toEqual({ mode: 'system', resolved: 'dark' })
    theme.setMode('light')
    expect(theme.snapshot()).toEqual({ mode: 'light', resolved: 'light' })
    theme.dispose()
  })
})

describe('early head appearance bootstrap', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  function bootstrap(preference: string | null, dark: boolean, blocked = false) {
    const script = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)?.[1]
    expect(script, 'an inline head bootstrap must run before the app styles').toBeTruthy()
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }
    const metas = new Map<string, string>()
    const document = {
      documentElement: root,
      querySelector: (selector: string) => ({ setAttribute: (_: string, value: string) => metas.set(selector, value) }),
    }
    runInNewContext(script!, { document, window: {
      get localStorage() { if (blocked) throw new Error('blocked'); return { getItem: (key: string) => key === THEME_STORAGE_KEY ? preference : null } },
      matchMedia: () => ({ matches: dark }),
    } })
    return { root, metas }
  }

  it.each([
    [null, false, 'system', 'light'], [null, true, 'system', 'dark'],
    ['dark', false, 'dark', 'dark'], ['light', true, 'light', 'light'],
    ['invalid', true, 'system', 'dark'],
  ] as const)('matches mounted state for preference=%s, dark=%s', (preference, dark, mode, resolved) => {
    const { root, metas } = bootstrap(preference, dark)
    const theme = createThemeController(environment(preference, dark).env)
    expect(root.dataset).toEqual({ theme: resolved, themeMode: mode })
    expect(root.style.colorScheme).toBe(resolved)
    expect(root.style.backgroundColor).toBe(resolved === 'dark' ? '#111c17' : '#f7f8f2')
    expect(metas.get('meta[name="theme-color"]')).toBe(root.style.backgroundColor)
    expect(metas.get('meta[name="color-scheme"]')).toBe(resolved)
    expect(theme.snapshot()).toEqual({ mode, resolved })
  })

  it('still follows the OS if access to localStorage itself throws', () => {
    expect(bootstrap(null, true, true).root.dataset).toEqual({ theme: 'dark', themeMode: 'system' })
  })
})
