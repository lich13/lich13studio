import store from '@renderer/store'
import { applyPlatformCatalog } from '@renderer/store/llm'
import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import { bundledModelCatalogs } from '@shared/modelCatalog/runtime'
import { fetchPlatformModelCatalog } from '@shared/modelCatalog/sources'
import {
  canonicalModels,
  CATALOG_INTERVAL,
  catalogDigest,
  ModelCatalogError,
  type PlatformModelCatalogSnapshot,
  validateCatalog
} from '@shared/modelCatalog/types'
import { PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import Dexie, { type EntityTable } from 'dexie'

export interface ModelCatalogCache {
  snapshot: PlatformModelCatalogSnapshot
  checkedAt: number
  syncedAt: number
}
export interface ModelCatalogStorage {
  read(platform: ProviderPlatform): Promise<ModelCatalogCache | undefined>
  write(platform: ProviderPlatform, value: ModelCatalogCache): Promise<void>
}
type CatalogDatabase = Dexie & {
  entries: EntityTable<{ platform: ProviderPlatform; value: ModelCatalogCache }, 'platform'>
}
class CatalogStorage implements ModelCatalogStorage {
  private db?: CatalogDatabase
  private database() {
    if (!this.db) {
      this.db = new Dexie('lich13studio-model-catalog-cache') as CatalogDatabase
      this.db.version(1).stores({ entries: '&platform' })
    }
    return this.db
  }
  async read(platform: ProviderPlatform) {
    return (await this.database().entries.get(platform))?.value
  }
  async write(platform: ProviderPlatform, value: ModelCatalogCache) {
    await this.database().entries.put({ platform, value })
  }
}

export interface ModelCatalogState extends ModelCatalogCache {
  source: 'bundled' | 'cache' | 'remote'
  status: 'idle' | 'checking' | 'error'
  error?: string
}

export class PlatformModelCatalogService {
  private states = Object.fromEntries(
    PROVIDER_PLATFORMS.map((platform) => [
      platform,
      { snapshot: bundledModelCatalogs[platform], checkedAt: 0, syncedAt: 0, source: 'bundled', status: 'idle' }
    ])
  ) as Record<ProviderPlatform, ModelCatalogState>
  private listeners = new Set<() => void>()
  private pending = new Map<ProviderPlatform, Promise<void>>()
  private initialization?: Promise<void>
  constructor(
    private readonly storage: ModelCatalogStorage = new CatalogStorage(),
    private readonly fetcher: typeof fetch = (input, init) => (getTauriNativeFetch() ?? fetch)(input, init),
    private readonly now: () => number = Date.now,
    private readonly apply: (snapshot: PlatformModelCatalogSnapshot, broadcast?: boolean) => void = (
      snapshot,
      broadcast = true
    ) => {
      store.dispatch({ ...applyPlatformCatalog(snapshot), ...(!broadcast ? { meta: { fromSync: true } } : {}) })
    }
  ) {}

  getSnapshot = (platform: ProviderPlatform) => this.states[platform]
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(platform: ProviderPlatform, changes: Partial<ModelCatalogState>) {
    this.states[platform] = { ...this.states[platform], ...changes }
    for (const listener of [...this.listeners])
      try {
        listener()
      } catch {
        /* UI errors cannot invalidate an update. */
      }
  }

  initialize(): Promise<void> {
    this.initialization ??= (async () => {
      await Promise.allSettled(
        PROVIDER_PLATFORMS.map(async (platform) => {
          let active = this.states[platform]
          try {
            const cached = await this.storage.read(platform)
            if (cached) {
              validateCatalog(cached.snapshot)
              if (
                cached.snapshot.platform !== platform ||
                !Number.isFinite(cached.checkedAt) ||
                !Number.isFinite(cached.syncedAt) ||
                cached.checkedAt < 0 ||
                cached.syncedAt < 0 ||
                (await catalogDigest(JSON.stringify(canonicalModels(cached.snapshot.models)))) !==
                  cached.snapshot.sha256
              )
                throw new Error('Invalid cache')
              // An older cache must not hide models shipped with an application update.
              const version = (release = '') => release.replace('rust-v', '').split('.').map(Number)
              const old = version(cached.snapshot.release),
                bundled = version(bundledModelCatalogs[platform].release)
              const older =
                platform === 'openai' &&
                old.some(
                  (value, index) =>
                    value < bundled[index] && old.slice(0, index).every((item, i) => item === bundled[i])
                )
              if (!older) active = { ...cached, source: 'cache', status: 'idle' }
            }
          } catch {
            /* Corrupt/disposable cache falls back to the bundled snapshot. */
          }
          this.apply(active.snapshot, false)
          this.update(platform, active)
        })
      )
    })()
    return this.initialization
  }

  sync(platform: ProviderPlatform, force = false): Promise<void> {
    const pending = this.pending.get(platform)
    if (pending) return pending
    const task = this.synchronize(platform, force).finally(() => this.pending.delete(platform))
    this.pending.set(platform, task)
    return task
  }
  private async synchronize(platform: ProviderPlatform, force: boolean) {
    await this.initialize()
    const now = this.now(),
      previous = this.states[platform]
    if (!force && previous.checkedAt > 0 && now >= previous.checkedAt && now - previous.checkedAt < CATALOG_INTERVAL)
      return
    this.update(platform, { status: 'checking', error: undefined })
    try {
      const snapshot = await fetchPlatformModelCatalog(platform, this.fetcher)
      const next = { snapshot, checkedAt: now, syncedAt: this.now() }
      try {
        await this.storage.write(platform, next)
      } catch {
        throw new ModelCatalogError('cache', 'Unable to save model catalog')
      }
      this.apply(snapshot)
      this.update(platform, { ...next, source: 'remote', status: 'idle', error: undefined })
    } catch (error) {
      try {
        await this.storage.write(platform, { snapshot: previous.snapshot, checkedAt: now, syncedAt: previous.syncedAt })
      } catch {
        /* Retain last-good memory. */
      }
      this.update(platform, {
        checkedAt: now,
        status: 'error',
        error: error instanceof Error ? error.message : 'Model catalog update failed'
      })
    }
  }
  start(): () => void {
    const sync = () => {
      for (const platform of PROVIDER_PLATFORMS) void this.sync(platform)
    }
    const foreground = () => {
      if (document.visibilityState === 'visible') sync()
    }
    sync()
    const timer = setInterval(sync, CATALOG_INTERVAL)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', foreground)
    }
  }
}

export const platformModelCatalogService = new PlatformModelCatalogService()
