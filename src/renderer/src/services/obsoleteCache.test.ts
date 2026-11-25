import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearObsoleteCache } from './obsoleteCache'

afterEach(() => vi.unstubAllGlobals())

describe('obsolete cache cleanup', () => {
  it('deletes retired IndexedDB cache and legacy failed_favicon_* localStorage entries without touching active keys', async () => {
    const store = new Map<string, string>([
      ['failed_favicon_https://icon.horse/icon/example.invalid', '1700000000000'],
      ['failed_favicon_https://favicon.im/example.invalid', '1700000000001'],
      ['persist:cherry-studio', '{"theme":"dark"}']
    ])
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      }
    })

    const request = {} as IDBOpenDBRequest
    const deleteDatabase = vi.fn(() => request)
    vi.stubGlobal('indexedDB', { deleteDatabase })
    for (let attempt = 0; attempt < 2; attempt++) {
      const cleanup = clearObsoleteCache()
      request.onsuccess?.call(request, {} as Event)
      await cleanup
    }
    expect(deleteDatabase.mock.calls).toEqual([['lich13studio-modeltrace-cache'], ['lich13studio-modeltrace-cache']])
    expect(Array.from(store.keys())).toEqual(['persist:cherry-studio'])
  })

  it.each(['onerror', 'onblocked'] as const)('reports %s for a restart retry', async (event) => {
    const request = {} as IDBOpenDBRequest
    vi.stubGlobal('indexedDB', { deleteDatabase: () => request })
    const cleanup = clearObsoleteCache()
    const rejected = expect(cleanup).rejects.toThrow(/Obsolete cache/)
    request[event]?.call(request, {} as IDBVersionChangeEvent)
    await rejected
  })
})
