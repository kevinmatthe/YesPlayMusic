export interface DeviceAudioRecord {
  key: string
  namespace: string
  trackID: string
  blob: Blob
  byteLength: number
  digest: string
  canonicalDurationMs: number
  durationMs: number
  createdAt: number
  lastUsedAt: number
  source: { mediaSource?: string; originTrackID?: string; matchMethod?: string; verification?: string; reason?: string }
}
export type DeviceAudioSummary = Omit<DeviceAudioRecord, 'blob' | 'source' | 'digest'>
export interface DeviceAudioStore {
  get(key: string): Promise<DeviceAudioRecord | undefined>
  list(): Promise<DeviceAudioSummary[]>
  save(record: DeviceAudioRecord, budgetBytes: number): Promise<void>
  touch(key: string, at: number): Promise<void>
  remove(key: string): Promise<void>
  clear(namespace: string): Promise<void>
  enabled(namespace: string): Promise<boolean>
  setEnabled(namespace: string, value: boolean): Promise<void>
}

// Planning is pure; IndexedDB serializes the corresponding read/delete/put
// sequence inside one readwrite transaction, including across browser tabs.
export function evictionKeys(records: readonly DeviceAudioSummary[], incoming: DeviceAudioSummary, budgetBytes: number): string[] {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0 ||
      !Number.isSafeInteger(incoming.byteLength) || incoming.byteLength <= 0 || incoming.byteLength > budgetBytes) {
    throw new RangeError('Device audio cache capacity exceeded')
  }
  const existing = records.filter(record => record.key !== incoming.key)
  let used = incoming.byteLength
  for (const record of existing) {
    if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 0) throw new Error('Invalid device audio cache size')
    used += record.byteLength
  }
  const evicted: string[] = []
  existing.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.key.localeCompare(b.key))
  for (const record of existing) {
    if (used <= budgetBytes) break
    evicted.push(record.key)
    used -= record.byteLength
  }
  return evicted
}

function summary(record: DeviceAudioRecord): DeviceAudioSummary {
  return {
    key: record.key, namespace: record.namespace, trackID: record.trackID,
    byteLength: record.byteLength, canonicalDurationMs: record.canonicalDurationMs,
    durationMs: record.durationMs, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt,
  }
}

// Store only the contract's explicit fields. An upstream Resolution's signed
// URL or any accidental additional credential fields must never be cloned here.
function storedRecord(record: DeviceAudioRecord): DeviceAudioRecord {
  const source: DeviceAudioRecord['source'] = {}
  for (const key of ['mediaSource', 'originTrackID', 'matchMethod', 'verification', 'reason'] as const) {
    if (typeof record.source[key] === 'string') source[key] = record.source[key]
  }
  return { ...summary(record), blob: record.blob, digest: record.digest, source }
}

type Guard = (callback: () => void) => () => void

export function createIndexedDBAudioStore(factory?: IDBFactory): DeviceAudioStore {
  let opening: Promise<IDBDatabase> | undefined
  function open(): Promise<IDBDatabase> {
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        // Opaque/blocked browser contexts may throw even on this property read.
        // Keep it inside the promise so constructing the app never fails here.
        const available = factory ?? globalThis.indexedDB
        if (!available) { reject(new Error('IndexedDB unavailable')); return }
        const request = available.open('betago-device-audio-v1', 1)
        let failed = false
        let failure: unknown
        const fail = (error: unknown) => { failed = true; failure = error; reject(error) }
        request.onblocked = () => fail(new Error('Device audio cache upgrade blocked'))
        request.onerror = () => fail(failure || request.error || new Error('Device audio cache open failed'))
        request.onupgradeneeded = () => {
          if (failed) { request.transaction?.abort(); return }
          try {
            const db = request.result
            const audio = db.objectStoreNames.contains('audio')
              ? request.transaction!.objectStore('audio')
              : db.createObjectStore('audio', { keyPath: 'key' })
            if (!audio.indexNames.contains('namespace')) audio.createIndex('namespace', 'namespace')
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'namespace' })
          } catch (error) {
            fail(error)
            request.transaction?.abort()
          }
        }
        request.onsuccess = () => {
          const db = request.result
          if (failed) { db.close(); return }
          db.onversionchange = () => { db.close(); opening = undefined }
          db.onclose = () => { opening = undefined }
          resolve(db)
        }
      }).catch(error => { opening = undefined; throw error })
    }
    return opening
  }

  async function run<T>(stores: string[], mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void, guard: Guard) => void): Promise<T> {
    const db = await open()
    // All awaits finish before the transaction starts. Requests and their
    // continuations below remain in IndexedDB's active event callbacks.
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let result: T
      let failure: unknown
      const fail = (error: unknown) => {
        failure = error
        try { tx.abort() } catch { reject(error) }
      }
      const guard: Guard = callback => () => { try { callback() } catch (error) { fail(error) } }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure || tx.error || new Error('Device audio cache transaction aborted'))
      tx.onerror = event => reject(failure || tx.error || (event.target as IDBRequest).error || new Error('Device audio cache transaction failed'))
      try { work(tx, value => { result = value }, guard) } catch (error) { fail(error) }
    })
  }

  return {
    get: key => run<DeviceAudioRecord | undefined>(['audio'], 'readonly', (tx, result, guard) => {
      const request = tx.objectStore('audio').get(key)
      request.onsuccess = guard(() => result(request.result ? storedRecord(request.result) : undefined))
    }),
    list: () => run<DeviceAudioSummary[]>(['audio'], 'readonly', (tx, result, guard) => {
      const request = tx.objectStore('audio').getAll()
      // Blob handles are cloned by IndexedDB; this does not read their bytes.
      request.onsuccess = guard(() => result((request.result as DeviceAudioRecord[]).map(summary)))
    }),
    async save(record, budgetBytes) {
      const incoming = storedRecord(record)
      evictionKeys([], summary(incoming), budgetBytes)
      if (incoming.blob.size !== incoming.byteLength) throw new Error('Device audio cache byte length mismatch')
      await run<void>(['audio'], 'readwrite', (tx, _result, guard) => {
        const audio = tx.objectStore('audio')
        const request = audio.getAll()
        request.onsuccess = guard(() => {
          const keys = evictionKeys((request.result as DeviceAudioRecord[]).map(summary), summary(incoming), budgetBytes)
          for (const key of keys) audio.delete(key)
          audio.put(incoming)
        })
      })
    },
    touch: (key, at) => run<void>(['audio'], 'readwrite', (tx, _result, guard) => {
      if (!Number.isFinite(at)) throw new Error('Invalid device audio cache access time')
      const audio = tx.objectStore('audio')
      const request = audio.get(key)
      request.onsuccess = guard(() => {
        if (!request.result) return
        const record = storedRecord(request.result)
        record.lastUsedAt = Math.max(record.lastUsedAt, at)
        audio.put(record)
      })
    }),
    remove: key => run<void>(['audio'], 'readwrite', tx => { tx.objectStore('audio').delete(key) }),
    clear: namespace => run<void>(['audio'], 'readwrite', (tx, _result, guard) => {
      const audio = tx.objectStore('audio')
      const request = audio.index('namespace').openKeyCursor(namespace)
      request.onsuccess = guard(() => {
        const cursor = request.result
        if (cursor) { audio.delete(cursor.primaryKey); cursor.continue() }
      })
    }),
    enabled: namespace => run<boolean>(['settings'], 'readonly', (tx, result, guard) => {
      const request = tx.objectStore('settings').get(namespace)
      request.onsuccess = guard(() => result(request.result?.enabled !== false))
    }),
    setEnabled: (namespace, value) => run<void>(['settings'], 'readwrite', tx => {
      tx.objectStore('settings').put({ namespace, enabled: value })
    }),
  }
}
