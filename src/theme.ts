export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export interface ThemeSnapshot { mode: ThemeMode; resolved: ResolvedTheme }
export interface ThemeEnvironment {
  read(): unknown
  write(mode: ThemeMode): void
  prefersDark(): boolean
  watchSystem(listener: (dark: boolean) => void): () => void
  watchStorage(listener: (key: string | null, value: string | null) => void): () => void
  apply(snapshot: ThemeSnapshot): void
}
export const THEME_STORAGE_KEY = 'betago:theme-mode'
const themeColor = { light: '#f7f8f2', dark: '#111c17' } as const
const normalizeMode = (value: unknown): ThemeMode => value === 'light' || value === 'dark' ? value : 'system'

export function createThemeController(environment: ThemeEnvironment) {
  let mode: ThemeMode = 'system'
  let systemDark = false
  let disposed = false
  const listeners = new Set<(snapshot: ThemeSnapshot) => void>()
  try { mode = normalizeMode(environment.read()) } catch { /* Private mode may block storage. */ }
  try { systemDark = environment.prefersDark() } catch { /* An unavailable OS preference defaults to light. */ }
  const snapshot = (): ThemeSnapshot => ({ mode, resolved: mode === 'system' ? systemDark ? 'dark' : 'light' : mode })
  const publish = () => {
    environment.apply(snapshot())
    listeners.forEach(listener => listener(snapshot()))
  }
  const update = (nextMode: ThemeMode, dark = systemDark) => {
    const before = snapshot()
    mode = nextMode
    systemDark = dark
    if (before.mode !== mode || before.resolved !== snapshot().resolved) publish()
  }
  publish()
  const stopSystem = environment.watchSystem(dark => { if (!disposed) update(mode, dark) })
  const stopStorage = environment.watchStorage(key => {
    if (disposed || (key !== THEME_STORAGE_KEY && key !== null)) return
    // A queued event can predate this tab's latest write. Use the current
    // shared value, and retain the usable in-memory choice if reads fail.
    let current: unknown
    try { current = environment.read() } catch { return }
    update(normalizeMode(current))
  })
  return {
    snapshot,
    setMode(nextMode: ThemeMode) {
      if (disposed) return
      const next = normalizeMode(nextMode)
      update(next)
      try { environment.write(next) } catch { /* Keep the current in-memory choice usable. */ }
    },
    subscribe(listener: (snapshot: ThemeSnapshot) => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      listener(snapshot())
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopSystem(); stopStorage(); listeners.clear()
    },
  }
}

export function createBrowserThemeEnvironment(browser: Window, document: Document): ThemeEnvironment {
  let media: MediaQueryList | undefined
  try { media = browser.matchMedia('(prefers-color-scheme: dark)') } catch { /* Embedded browsers may lack this API. */ }
  return {
    read: () => browser.localStorage.getItem(THEME_STORAGE_KEY),
    write: mode => browser.localStorage.setItem(THEME_STORAGE_KEY, mode),
    prefersDark: () => media?.matches ?? false,
    watchSystem(listener) {
      const query = media
      if (!query) return () => {}
      const change = (event: MediaQueryListEvent) => listener(event.matches)
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', change)
        return () => query.removeEventListener('change', change)
      }
      if (typeof query.addListener === 'function') {
        query.addListener(change)
        return () => query.removeListener(change)
      }
      return () => {}
    },
    watchStorage(listener) {
      const change = (event: StorageEvent) => {
        // sessionStorage changes are unrelated to this device preference.
        if (event.storageArea) {
          try { if (event.storageArea !== browser.localStorage) return } catch { return }
        }
        listener(event.key, event.newValue)
      }
      browser.addEventListener('storage', change)
      return () => browser.removeEventListener('storage', change)
    },
    apply(state) {
      const root = document.documentElement
      root.dataset.theme = state.resolved
      root.dataset.themeMode = state.mode
      root.style.colorScheme = state.resolved
      root.style.backgroundColor = themeColor[state.resolved]
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor[state.resolved])
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', state.resolved)
    },
  }
}

let browserTheme: ReturnType<typeof createThemeController> | undefined
export function getThemeController() {
  return browserTheme ??= createThemeController(createBrowserThemeEnvironment(window, document))
}
export function disposeThemeController() {
  browserTheme?.dispose()
  browserTheme = undefined
}
