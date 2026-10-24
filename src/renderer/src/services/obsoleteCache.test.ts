import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearObsoleteCache } from './obsoleteCache'

afterEach(() => vi.unstubAllGlobals())

describe('obsolete cache cleanup', () => {
  it('deletes only the retired cache and can run again after deletion', async () => {
    const request = {} as IDBOpenDBRequest
    const deleteDatabase = vi.fn(() => request)
    vi.stubGlobal('indexedDB', { deleteDatabase })
    for (let attempt = 0; attempt < 2; attempt++) {
      const cleanup = clearObsoleteCache()
      request.onsuccess?.call(request, {} as Event)
      await cleanup
    }
    expect(deleteDatabase.mock.calls).toEqual([['lich13studio-modeltrace-cache'], ['lich13studio-modeltrace-cache']])
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
