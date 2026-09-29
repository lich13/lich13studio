import { bundledModelCatalogs } from '@shared/modelCatalog/runtime'
import { CATALOG_INTERVAL } from '@shared/modelCatalog/types'
import type { ProviderPlatform } from '@shared/platforms'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/store', () => ({ default: { dispatch: vi.fn() } }))
vi.mock('@renderer/store/llm', () => ({
  applyPlatformCatalog: (payload: unknown) => ({ type: 'llm/applyPlatformCatalog', payload })
}))
vi.mock('@renderer/utils/tauriNativeFetch', () => ({ getTauriNativeFetch: () => undefined }))

import {
  type ModelCatalogCache,
  type ModelCatalogStorage,
  PlatformModelCatalogService
} from './PlatformModelCatalogService'

const html = (id = 'grok-catalog-new') =>
  `<script>globalThis.__XAI_PUBLIC_MODELS__=${JSON.stringify({ clusterConfigs: [{ languageModels: [{ name: id, inputModalities: ['TEXT', 'IMAGE'], outputModalities: ['TEXT'], features: { reasoning: true, functionCalling: true } }] }] })};</script>`
class MemoryStorage implements ModelCatalogStorage {
  data = new Map<ProviderPlatform, ModelCatalogCache>()
  read = vi.fn(async (platform: ProviderPlatform) => this.data.get(platform))
  write = vi.fn(async (platform: ProviderPlatform, value: ModelCatalogCache) => {
    this.data.set(platform, structuredClone(value))
  })
}
const setup = (fetcher: typeof fetch = vi.fn(async () => new Response(html()))) => {
  const storage = new MemoryStorage(),
    apply = vi.fn(),
    time = { value: 1_000_000 }
  const service = new PlatformModelCatalogService(storage, fetcher, () => time.value, apply)
  return { service, storage, apply, time, fetcher }
}

describe('platform catalog synchronization', () => {
  it('loads bundled data immediately and performs independent hourly anonymous checks', async () => {
    const { service, apply, time, fetcher } = setup()
    await service.initialize()
    expect(apply).toHaveBeenCalledTimes(3)
    await service.sync('grok')
    expect(service.getSnapshot('grok').source).toBe('remote')
    await service.sync('grok')
    expect(fetcher).toHaveBeenCalledTimes(1)
    time.value += CATALOG_INTERVAL
    await service.sync('grok')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetcher).mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
    expect(service.getSnapshot('anthropic').source).toBe('bundled')
  })
  it('coalesces overlapping sync calls and only applies after atomic persistence succeeds', async () => {
    let resolve!: (response: Response) => void
    const { service, storage, apply } = setup(
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          })
      )
    )
    await service.initialize()
    apply.mockClear()
    const one = service.sync('grok'),
      two = service.sync('grok', true)
    expect(one).toBe(two)
    await Promise.resolve()
    resolve(new Response(html()))
    await one
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(storage.data.get('grok')!.snapshot.models[0].id).toBe('grok-catalog-new')
  })
  it('keeps last-good data on offline, rate-limit and invalid downloads', async () => {
    const fetcher = vi.fn(async () => new Response(html()))
    const { service, storage } = setup(fetcher)
    await service.sync('grok')
    const last = service.getSnapshot('grok').snapshot
    for (const response of [new Response('rate limited', { status: 429 }), new Response('<html>changed</html>')]) {
      fetcher.mockResolvedValueOnce(response)
      await service.sync('grok', true)
      expect(service.getSnapshot('grok')).toMatchObject({ status: 'error', snapshot: last })
      expect(storage.data.get('grok')!.snapshot).toEqual(last)
    }
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await service.sync('grok', true)
    expect(service.getSnapshot('grok').error).toContain('offline')
  })
  it('ignores damaged cache and does not publish a snapshot whose write failed', async () => {
    const { service, storage, apply } = setup()
    storage.data.set('grok', {
      snapshot: { ...bundledModelCatalogs.grok, sha256: '0'.repeat(64) },
      checkedAt: 1,
      syncedAt: 1
    })
    await service.initialize()
    expect(service.getSnapshot('grok').source).toBe('bundled')
    apply.mockClear()
    storage.write.mockRejectedValue(new Error('disk full'))
    await service.sync('grok', true)
    expect(apply).not.toHaveBeenCalled()
    expect(service.getSnapshot('grok')).toMatchObject({ source: 'bundled', status: 'error' })
  })
  it('restores a valid cache after restart, keeping stable snapshots and isolating subscribers', async () => {
    const { service, storage, time, fetcher } = setup()
    const listener = vi.fn(() => {
      throw new Error('view failure')
    })
    service.subscribe(listener)
    await service.sync('grok')
    const snapshot = service.getSnapshot('grok')
    expect(service.getSnapshot('grok')).toBe(snapshot)
    expect(snapshot.status).toBe('idle')
    const restarted = new PlatformModelCatalogService(storage, fetcher, () => time.value, vi.fn())
    await restarted.sync('grok')
    expect(restarted.getSnapshot('grok').source).toBe('cache')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
