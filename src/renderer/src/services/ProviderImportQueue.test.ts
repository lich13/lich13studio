import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callback: undefined as ((urls: string[]) => void) | undefined,
  current: ['ccswitch://v1/import?cold']
}))
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: async () => mocks.current,
  onOpenUrl: async (callback: (urls: string[]) => void) => {
    mocks.callback = callback
    return () => undefined
  }
}))

describe('provider deep link lifecycle', () => {
  it('queues cold and running links before UI initialization, deduplicates delivery, and releases completed URLs', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const { startProviderImportListener, providerImportQueue } = await import('./ProviderImportQueue')
    startProviderImportListener()
    await vi.waitFor(() => expect(mocks.callback).toBeDefined())
    await Promise.resolve()
    mocks.callback!(['ccswitch://v1/import?cold', 'ccswitch://v1/import?running', 'https://example.com'])
    const received: string[] = []
    const stop = providerImportQueue.subscribe(() => {
      let url: string | undefined
      while ((url = providerImportQueue.take())) received.push(url)
    })
    expect(received).toEqual(['ccswitch://v1/import?cold', 'ccswitch://v1/import?running'])
    mocks.callback!(['ccswitch://v1/import?running'])
    expect(received).toHaveLength(2)
    providerImportQueue.complete('ccswitch://v1/import?running')
    mocks.callback!(['ccswitch://v1/import?running'])
    expect(received).toHaveLength(3)
    stop()
    vi.unstubAllGlobals()
  })
})
