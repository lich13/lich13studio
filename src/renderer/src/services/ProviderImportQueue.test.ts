import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callback: undefined as (() => void) | undefined,
  nativeQueue: ['ccswitch://v1/import?cold', 'ccswitch://v1/import?early-second'],
  windowLabel: 'mini'
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => mocks.nativeQueue.splice(0)) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: mocks.windowLabel }) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, callback: () => void) => {
    mocks.callback = callback
    return () => undefined
  }
}))

describe('provider deep link lifecycle', () => {
  it('retains all early links, excludes mini windows, serializes UI delivery and allows completed links again', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const { startProviderImportListener, providerImportQueue } = await import('./ProviderImportQueue')
    startProviderImportListener()
    expect(mocks.callback).toBeUndefined()
    expect(mocks.nativeQueue).toHaveLength(2)
    mocks.windowLabel = 'main'
    startProviderImportListener()
    await vi.waitFor(() => expect(mocks.nativeQueue).toHaveLength(0))
    const received: string[] = []
    const stop = providerImportQueue.subscribe(() => {
      let url: string | undefined
      while ((url = providerImportQueue.take())) received.push(url)
    })
    expect(received).toEqual(['ccswitch://v1/import?cold', 'ccswitch://v1/import?early-second'])
    mocks.nativeQueue.push('ccswitch://v1/import?cold', 'ccswitch://v1/import?running', 'https://example.com')
    mocks.callback!()
    await vi.waitFor(() => expect(received).toHaveLength(3))
    expect(received[2]).toBe('ccswitch://v1/import?running')
    providerImportQueue.complete(received[2])
    mocks.nativeQueue.push(received[2])
    mocks.callback!()
    await vi.waitFor(() => expect(received).toHaveLength(4))
    for (const url of received) providerImportQueue.complete(url)
    received.length = 0
    const { PROVIDER_IMPORT_MAX_QUEUE, PROVIDER_IMPORT_REJECTED_MARKER, PROVIDER_IMPORT_MAX_LINK_LENGTH } =
      await import('@shared/providerImport')
    const flood = Array.from({ length: PROVIDER_IMPORT_MAX_QUEUE + 3 }, (_, i) => `ccswitch://v1/import?flood=${i}`)
    mocks.nativeQueue.push(`ccswitch://v1/import?${'x'.repeat(PROVIDER_IMPORT_MAX_LINK_LENGTH)}`, ...flood)
    mocks.callback!()
    await vi.waitFor(() => expect(received).toHaveLength(PROVIDER_IMPORT_MAX_QUEUE + 1))
    expect(received.slice(0, PROVIDER_IMPORT_MAX_QUEUE)).toEqual(flood.slice(0, PROVIDER_IMPORT_MAX_QUEUE))
    expect(received.at(-1)).toBe(PROVIDER_IMPORT_REJECTED_MARKER)
    stop()
    vi.unstubAllGlobals()
  })
})
