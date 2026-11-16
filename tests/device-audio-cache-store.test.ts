import { describe, expect, it, vi } from 'vitest'
import { createIndexedDBAudioStore, evictionKeys } from '../src/core/device-audio-cache-store'
import type { DeviceAudioRecord, DeviceAudioSummary } from '../src/core/device-audio-cache-store'

function summary(key: string, byteLength: number, lastUsedAt = 0, namespace = 'owner-a'): DeviceAudioSummary {
  return { key, namespace, trackID: `netease:${key}`, byteLength, canonicalDurationMs: 200_000,
    durationMs: 200_010, createdAt: 0, lastUsedAt }
}
function record(key = 'one', byteLength = 10): DeviceAudioRecord {
  return { ...summary(key, byteLength), blob: new Blob([new Uint8Array(byteLength)]), digest: 'sha256', source: {} }
}

describe('device audio capacity planning', () => {
  it('keeps entries when a new full record fits, including the exact budget edge', () => {
    expect(evictionKeys([summary('one', 10)], summary('two', 10), 20)).toEqual([])
    expect(evictionKeys([], summary('one', 20), 20)).toEqual([])
  })

  it('evicts oldest access first rather than the first record returned by IndexedDB', () => {
    const rows = [summary('recent', 5, 3), summary('oldest', 5, 1), summary('middle', 5, 2)]
    expect(evictionKeys(rows, summary('incoming', 6, 4), 16)).toEqual(['oldest'])
    expect(evictionKeys(rows, summary('incoming', 11, 4), 16)).toEqual(['oldest', 'middle'])
    expect(rows.map(row => row.key)).toEqual(['recent', 'oldest', 'middle'])
  })

  it('does not count the old value twice when replacing the same key', () => {
    const rows = [summary('one', 10, 0), summary('two', 10, 1)]
    expect(evictionKeys(rows, summary('one', 15, 2), 25)).toEqual([])
    expect(evictionKeys(rows, summary('one', 15, 2), 20)).toEqual(['two'])
    expect(evictionKeys(rows, summary('one', 5, 2), 20)).toEqual([])
  })

  it('enforces one module-wide budget across owner namespaces', () => {
    const rows = [summary('old-a', 10, 1, 'owner-a'), summary('recent-b', 10, 2, 'owner-b')]
    expect(evictionKeys(rows, summary('new-b', 10, 3, 'owner-b'), 20)).toEqual(['old-a'])
  })

  it('breaks equal access times deterministically without changing input rows', () => {
    const rows = [summary('z', 10, 1), summary('a', 10, 1)]
    expect(evictionKeys(rows, summary('incoming', 10, 3), 20)).toEqual(['a'])
    expect(rows[0].key).toBe('z')
  })

  it.each([0, -1, NaN, Infinity, 1.5])('rejects an invalid incoming size %s without a deletion plan', size => {
    expect(() => evictionKeys([summary('existing', 10)], summary('new', size), 20)).toThrow()
  })

  it.each([0, -1, NaN, Infinity, 1.5])('rejects an impossible or invalid budget %s', budget => {
    expect(() => evictionKeys([summary('existing', 10)], summary('new', 1), budget)).toThrow()
  })

  it('rejects one incoming object larger than the whole budget', () => {
    expect(() => evictionKeys([summary('existing', 10)], summary('large', 21), 20)).toThrow()
  })
})

describe('IndexedDB audio store availability', () => {
  it('does not read a forbidden global IndexedDB getter until an operation needs storage', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    const denied = new DOMException('opaque origin storage denied', 'SecurityError')
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw denied } })
    try {
      let store: ReturnType<typeof createIndexedDBAudioStore> | undefined
      expect(() => { store = createIndexedDBAudioStore() }).not.toThrow()
      await expect(store!.list()).rejects.toBe(denied)
    } finally {
      if (previous) Object.defineProperty(globalThis, 'indexedDB', previous)
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    }
  })

  it('constructs lazily and rejects unavailable storage for each operation', async () => {
    const store = createIndexedDBAudioStore(undefined)
    const operations = [
      () => store.get('one'), () => store.list(), () => store.save(record(), 20),
      () => store.touch('one', 4), () => store.remove('one'), () => store.clear('owner-a'),
      () => store.enabled('owner-a'), () => store.setEnabled('owner-a', false),
    ]
    for (const operation of operations) await expect(operation()).rejects.toThrow()
  })

  it('retries a failed lazy open rather than retaining a permanently rejected promise', async () => {
    const denied = new DOMException('storage disabled', 'SecurityError')
    const open = vi.fn(() => { throw denied })
    const store = createIndexedDBAudioStore({ open } as unknown as IDBFactory)
    expect(open).not.toHaveBeenCalled()
    await expect(store.list()).rejects.toBe(denied)
    await expect(store.list()).rejects.toBe(denied)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('surfaces asynchronous database-open errors to callers', async () => {
    const failure = new DOMException('quota denied', 'QuotaExceededError')
    const request = { error: failure, onerror: null as ((event: Event) => void) | null }
    const factory = { open() { queueMicrotask(() => request.onerror?.(new Event('error'))); return request } }
    await expect(createIndexedDBAudioStore(factory as unknown as IDBFactory).list()).rejects.toBe(failure)
  })

  it('opens a fresh connection after the browser unexpectedly closes the database', async () => {
    const failure = new DOMException('database closed', 'InvalidStateError')
    const db = { transaction() { throw failure }, onclose: null as ((event: Event) => void) | null }
    const open = vi.fn(() => {
      const request = { result: db, onsuccess: null as ((event: Event) => void) | null }
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
      return request
    })
    const store = createIndexedDBAudioStore({ open } as unknown as IDBFactory)
    await expect(store.list()).rejects.toBe(failure)
    db.onclose?.(new Event('close'))
    await expect(store.list()).rejects.toBe(failure)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('closes a late successful connection after the open was rejected as blocked', async () => {
    const close = vi.fn()
    const request = {
      result: { close },
      onblocked: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
    }
    const factory = { open() { queueMicrotask(() => request.onblocked?.(new Event('blocked'))); return request } }
    await expect(createIndexedDBAudioStore(factory as unknown as IDBFactory).list()).rejects.toThrow()
    request.onsuccess?.(new Event('success'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects an oversized save before opening a database or changing existing entries', async () => {
    const open = vi.fn()
    const store = createIndexedDBAudioStore({ open } as unknown as IDBFactory)
    await expect(store.save(record('large', 21), 20)).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
})
