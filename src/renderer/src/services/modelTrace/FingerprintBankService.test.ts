import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/tauriNativeFetch', () => ({ getTauriNativeFetch: () => undefined }))

import sourceRaw from './data/unified_bank.json?raw'
import {
  bundledBankSnapshot,
  bundledRaw,
  type FingerprintBank,
  modelTraceManifest as manifest,
  validateFingerprintBank
} from './fingerprintBank'
import {
  FINGERPRINT_SYNC_INTERVAL_MS,
  type FingerprintBankCache,
  FingerprintBankService
} from './FingerprintBankService'

const NOW = Date.parse('2030-01-01T00:00:00.000Z')
const sourceBank = JSON.parse(sourceRaw) as FingerprintBank
const CACHE_REVISION = 'a'.repeat(40)
const REMOTE_REVISION = 'b'.repeat(40)
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex')
const gitBlob = (raw: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest('hex')

function bankFixture(days = 1): FingerprintBank {
  const bank = structuredClone(sourceBank) as FingerprintBank
  bank.built_at = new Date(Date.parse(sourceBank.built_at) + days * 86400000).toISOString()
  bank.models[0].counts[0] += days
  return bank
}

function cacheFixture(bank = bankFixture()): FingerprintBankCache {
  const rawBank = JSON.stringify(bank)
  return {
    rawBank,
    version: {
      revision: CACHE_REVISION,
      sha256: sha256(rawBank),
      builtAt: bank.built_at,
      analyzerVersion: manifest.analyzerVersion
    },
    coreBlob: manifest.files.core.gitBlob,
    challengeBlob: manifest.files.challenge.gitBlob,
    checkedAt: NOW - FINGERPRINT_SYNC_INTERVAL_MS,
    syncedAt: NOW - FINGERPRINT_SYNC_INTERVAL_MS
  }
}

function memoryStorage(initial?: FingerprintBankCache) {
  let saved = structuredClone(initial)
  return {
    read: vi.fn(async () => structuredClone(saved)),
    write: vi.fn(async (value: FingerprintBankCache) => {
      saved = structuredClone(value)
    }),
    get saved() {
      return structuredClone(saved)
    }
  }
}

function remoteFixture(raw = JSON.stringify(bankFixture(2)), revision = REMOTE_REVISION) {
  const urls = [
    `https://api.github.com/repos/${manifest.repository}/commits/${manifest.branch}`,
    `https://api.github.com/repos/${manifest.repository}/git/trees/${revision}?recursive=1`,
    `https://raw.githubusercontent.com/${manifest.repository}/${revision}/${manifest.files.bank.path}`
  ]
  const tree = {
    truncated: false,
    tree: [
      { path: manifest.files.core.path, type: 'blob', mode: '100644', sha: manifest.files.core.gitBlob },
      { path: manifest.files.challenge.path, type: 'blob', mode: '100644', sha: manifest.files.challenge.gitBlob },
      { path: manifest.files.bank.path, type: 'blob', mode: '100644', sha: gitBlob(raw) }
    ]
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === urls[0]) return new Response(JSON.stringify({ sha: revision }))
    if (url === urls[1]) return new Response(JSON.stringify(tree))
    if (url === urls[2]) return new Response(raw)
    throw new Error(`Unexpected test request: ${url}`)
  })
  return { fetcher, urls, tree, raw, revision }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fingerprint bank cache initialization', () => {
  it('uses the bundled snapshot when no cache exists and initializes only once', async () => {
    const storage = memoryStorage()
    const remote = remoteFixture()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    expect(service.capture()).toBe(bundledBankSnapshot)
    await Promise.all([service.initialize(), service.initialize()])
    await service.initialize()
    expect(storage.read).toHaveBeenCalledTimes(1)
    expect(storage.write).not.toHaveBeenCalled()
    expect(remote.fetcher).not.toHaveBeenCalled()
    expect(service.getSnapshot()).toMatchObject({ active: bundledBankSnapshot, source: 'bundled', status: 'idle' })
  })

  it('restores a verified newer cache with its provenance and freezes captured data', async () => {
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    const remote = remoteFixture()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    expect(service.capture()).toEqual({ bank: JSON.parse(cached.rawBank), version: cached.version })
    expect(service.getSnapshot()).toMatchObject({
      source: 'cache',
      checkedAt: cached.checkedAt,
      syncedAt: cached.syncedAt
    })
    expect(Object.isFrozen(service.capture())).toBe(true)
    expect(Object.isFrozen(service.capture().bank.models[0].counts)).toBe(true)
    expect(remote.fetcher).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
  })

  const corruptCaches: [string, (cache: FingerprintBankCache) => void][] = [
    [
      'SHA-256 mismatch',
      (cache) => {
        cache.version.sha256 = '0'.repeat(64)
      }
    ],
    [
      'invalid JSON with a matching digest',
      (cache) => {
        cache.rawBank = '{'
        cache.version.sha256 = sha256(cache.rawBank)
      }
    ],
    [
      'changed core algorithm',
      (cache) => {
        cache.coreBlob = 'c'.repeat(40)
      }
    ],
    [
      'changed challenge algorithm',
      (cache) => {
        cache.challengeBlob = 'c'.repeat(40)
      }
    ],
    [
      'unsupported analyzer version',
      (cache) => {
        cache.version.analyzerVersion += 1
      }
    ],
    [
      'invalid revision',
      (cache) => {
        cache.version.revision = 'main'
      }
    ],
    [
      'non-finite check time',
      (cache) => {
        cache.checkedAt = Number.NaN
      }
    ],
    [
      'negative sync time',
      (cache) => {
        cache.syncedAt = -1
      }
    ],
    [
      'inconsistent build time',
      (cache) => {
        cache.version.builtAt = sourceBank.built_at
      }
    ],
    [
      'older data',
      (cache) => {
        Object.assign(cache, cacheFixture(bankFixture(-1)))
      }
    ],
    [
      'invalid bank dimensions',
      (cache) => {
        const bank = bankFixture()
        bank.models[0].counts.pop()
        Object.assign(cache, cacheFixture(bank))
      }
    ]
  ]

  it.each(corruptCaches)('falls back to bundled data for %s', async (_label, corrupt) => {
    const cached = cacheFixture()
    corrupt(cached)
    const storage = memoryStorage(cached)
    const service = new FingerprintBankService(storage, remoteFixture().fetcher, () => NOW)
    await expect(service.initialize()).resolves.toBeUndefined()
    expect(service.capture()).toBe(bundledBankSnapshot)
    expect(service.getSnapshot()).toMatchObject({ source: 'bundled', status: 'idle' })
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('keeps bundled data usable when cache storage cannot be read', async () => {
    const storage = memoryStorage()
    storage.read.mockRejectedValue(new Error('IndexedDB unavailable'))
    const service = new FingerprintBankService(storage, remoteFixture().fetcher, () => NOW)
    await expect(service.initialize()).resolves.toBeUndefined()
    expect(service.capture()).toBe(bundledBankSnapshot)
  })
})

describe('fingerprint bank synchronization', () => {
  it('reads the tree and bank from the same commit and atomically saves compatible data and provenance', async () => {
    const storage = memoryStorage()
    const remote = remoteFixture()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    const previousCapture = service.capture()
    await service.sync()
    expect(remote.fetcher.mock.calls.map(([url]) => String(url))).toEqual(remote.urls)
    for (const [, options] of remote.fetcher.mock.calls) {
      expect(options).toMatchObject({ credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } })
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
    const expected = {
      rawBank: remote.raw,
      version: {
        revision: remote.revision,
        sha256: sha256(remote.raw),
        builtAt: bankFixture(2).built_at,
        analyzerVersion: manifest.analyzerVersion
      },
      coreBlob: manifest.files.core.gitBlob,
      challengeBlob: manifest.files.challenge.gitBlob,
      checkedAt: NOW,
      syncedAt: NOW
    }
    expect(storage.write).toHaveBeenCalledExactlyOnceWith(expected)
    expect(storage.saved).toEqual(expected)
    expect(service.getSnapshot()).toMatchObject({ source: 'remote', status: 'idle', checkedAt: NOW, syncedAt: NOW })
    expect(service.capture()).toEqual({ bank: JSON.parse(remote.raw), version: expected.version })
    expect(previousCapture).toBe(bundledBankSnapshot)
    expect(previousCapture.bank).toEqual(sourceBank)
    expect(Object.isFrozen(service.capture().bank.robust.hellinger.centroids[0])).toBe(true)
  })

  it('retains the same bank and version when upstream has not changed', async () => {
    const remote = remoteFixture(bundledRaw, manifest.revision)
    const storage = memoryStorage()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.sync()
    expect(service.capture()).toEqual(bundledBankSnapshot)
    expect(service.getSnapshot()).toMatchObject({ status: 'idle', checkedAt: NOW })
    expect(storage.saved?.version).toEqual(bundledBankSnapshot.version)
  })

  it('throttles automatic checks for one hour while allowing a forced check', async () => {
    let now = NOW
    const remote = remoteFixture()
    const service = new FingerprintBankService(memoryStorage(), remote.fetcher, () => now)
    await service.sync()
    now += FINGERPRINT_SYNC_INTERVAL_MS - 1
    await service.sync()
    expect(remote.fetcher).toHaveBeenCalledTimes(3)
    now += 1
    await service.sync()
    expect(remote.fetcher).toHaveBeenCalledTimes(6)
    await service.sync()
    expect(remote.fetcher).toHaveBeenCalledTimes(6)
    await service.sync(true)
    expect(remote.fetcher).toHaveBeenCalledTimes(9)
  })

  it('honors the persisted check time after restarting', async () => {
    const cached = cacheFixture()
    cached.checkedAt = NOW - 1
    const remote = remoteFixture()
    const service = new FingerprintBankService(memoryStorage(cached), remote.fetcher, () => NOW)
    await service.sync()
    expect(remote.fetcher).not.toHaveBeenCalled()
    expect(service.getSnapshot().source).toBe('cache')
    await service.sync(true)
    expect(remote.fetcher).toHaveBeenCalledTimes(3)
  })

  it('coalesces concurrent automatic and forced checks into one pending sync', async () => {
    const remote = remoteFixture()
    const head = deferred<Response>()
    remote.fetcher.mockImplementationOnce(() => head.promise)
    const storage = memoryStorage()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    const first = service.sync()
    expect(service.sync(true)).toBe(first)
    expect(service.sync()).toBe(first)
    await vi.waitFor(() => expect(remote.fetcher).toHaveBeenCalledTimes(1))
    head.resolve(new Response(JSON.stringify({ sha: remote.revision })))
    await first
    expect(remote.fetcher).toHaveBeenCalledTimes(3)
    expect(storage.write).toHaveBeenCalledTimes(1)
    await service.sync(true)
    expect(remote.fetcher).toHaveBeenCalledTimes(6)
  })

  it('keeps the last valid cache available offline and persists only the failed check time', async () => {
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    const remote = remoteFixture()
    remote.fetcher.mockRejectedValue(new TypeError('Offline'))
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    const previous = service.capture()
    await service.sync()
    expect(service.capture()).toBe(previous)
    expect(service.getSnapshot()).toMatchObject({ source: 'cache', status: 'error', error: 'network', checkedAt: NOW })
    expect(storage.saved).toEqual({ ...cached, checkedAt: NOW })
    await service.sync()
    expect(remote.fetcher).toHaveBeenCalledTimes(1)
    const restarted = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await restarted.sync()
    expect(restarted.capture()).toEqual(previous)
    expect(remote.fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([403, 429])('preserves last-good data after HTTP %i and allows an explicit retry', async (status) => {
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    const remote = remoteFixture()
    remote.fetcher.mockResolvedValue(new Response('rate limited', { status }))
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.sync()
    expect(service.capture().version).toEqual(cached.version)
    expect(service.getSnapshot()).toMatchObject({ source: 'cache', status: 'error', error: 'network' })
    expect(storage.saved).toEqual({ ...cached, checkedAt: NOW })
    await service.sync()
    expect(remote.fetcher).toHaveBeenCalledTimes(1)
    await service.sync(true)
    expect(remote.fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not expose a new bank until the cache write completes', async () => {
    const storage = memoryStorage(cacheFixture())
    const persist = storage.write.getMockImplementation()!
    const commit = deferred<void>()
    storage.write.mockImplementationOnce(async (next) => {
      await commit.promise
      await persist(next)
    })
    const remote = remoteFixture()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    const previous = service.capture()
    const syncing = service.sync(true)
    await vi.waitFor(() => expect(storage.write).toHaveBeenCalledTimes(1))
    expect(service.capture()).toBe(previous)
    expect(service.getSnapshot().status).toBe('checking')
    commit.resolve()
    await syncing
    expect(service.capture().version.revision).toBe(remote.revision)
    expect(service.getSnapshot().status).toBe('idle')
  })

  it('retains the active snapshot and stored record if the replacement write fails', async () => {
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    storage.write.mockRejectedValueOnce(new Error('QuotaExceededError'))
    const remote = remoteFixture()
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    const previous = service.capture()
    await service.sync(true)
    expect(service.capture()).toBe(previous)
    expect(service.getSnapshot()).toMatchObject({ source: 'cache', status: 'error', error: 'cache', checkedAt: NOW })
    expect(storage.saved).toEqual(cached)
    await service.sync(true)
    expect(service.getSnapshot()).toMatchObject({ source: 'remote', status: 'idle', error: undefined })
    expect(storage.saved?.version.revision).toBe(remote.revision)
  })

  it('starts hourly checks and stops scheduling after cleanup', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const remote = remoteFixture()
    const service = new FingerprintBankService(memoryStorage(), remote.fetcher, Date.now)
    const stop = service.start()
    try {
      await service.sync()
      expect(remote.fetcher).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(FINGERPRINT_SYNC_INTERVAL_MS - 1)
      expect(remote.fetcher).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      await service.sync()
      expect(remote.fetcher).toHaveBeenCalledTimes(6)
      stop()
      await vi.advanceTimersByTimeAsync(2 * FINGERPRINT_SYNC_INTERVAL_MS)
      expect(remote.fetcher).toHaveBeenCalledTimes(6)
    } finally {
      stop()
    }
  })
})

describe('fingerprint bank compatibility and integrity', () => {
  it.each([0, 1])('rejects changed upstream algorithm blob %i before downloading data', async (index) => {
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    const remote = remoteFixture()
    remote.tree.tree[index].sha = 'c'.repeat(40)
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.sync()
    expect(remote.fetcher.mock.calls.map(([url]) => String(url))).toEqual(remote.urls.slice(0, 2))
    expect(service.capture().version).toEqual(cached.version)
    expect(service.getSnapshot()).toMatchObject({ source: 'cache', status: 'upgrade-required', error: 'incompatible' })
    expect(storage.saved).toEqual({ ...cached, checkedAt: NOW })
  })

  it('rejects bank bytes that do not match the commit tree git blob', async () => {
    const storage = memoryStorage(cacheFixture())
    const remote = remoteFixture()
    remote.tree.tree[2].sha = 'c'.repeat(40)
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    const previous = service.capture()
    await service.sync()
    expect(service.capture()).toBe(previous)
    expect(service.getSnapshot()).toMatchObject({ status: 'error', error: 'invalid-data' })
    expect(storage.saved?.version).toEqual(previous.version)
  })

  it('rejects a truncated commit tree without replacing the bundled bank', async () => {
    const remote = remoteFixture()
    remote.tree.truncated = true
    const service = new FingerprintBankService(memoryStorage(), remote.fetcher, () => NOW)
    await service.sync()
    expect(service.capture()).toBe(bundledBankSnapshot)
    expect(service.getSnapshot()).toMatchObject({ status: 'error', error: 'invalid-data' })
    expect(remote.fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects data older than the last valid cache even when newer than the bundled bank', async () => {
    const cached = cacheFixture(bankFixture(3))
    const storage = memoryStorage(cached)
    const remote = remoteFixture(JSON.stringify(bankFixture(2)))
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.sync()
    expect(service.capture().version).toEqual(cached.version)
    expect(service.getSnapshot()).toMatchObject({ status: 'upgrade-required', error: 'incompatible' })
    expect(storage.saved).toEqual({ ...cached, checkedAt: NOW })
  })

  const invalidBanks: [string, (bank: FingerprintBank) => void][] = [
    [
      'unknown schema',
      (bank) => {
        bank.schema = 'unknown-bank'
      }
    ],
    [
      'invalid build date',
      (bank) => {
        bank.built_at = 'not-a-date'
      }
    ],
    [
      'missing model label',
      (bank) => {
        bank.models[0].display_name = ''
      }
    ],
    [
      'duplicate model identity',
      (bank) => {
        bank.models[1].id = bank.models[0].id
      }
    ],
    [
      'wrong model order',
      (bank) => {
        bank.robust.model_order.reverse()
      }
    ],
    [
      'wrong method range',
      (bank) => {
        bank.method.range = [1, 354]
      }
    ],
    [
      'count dimensions',
      (bank) => {
        bank.models[0].counts.pop()
      }
    ],
    [
      'negative count',
      (bank) => {
        bank.models[0].counts[0] = -1
      }
    ],
    [
      'Hellinger dimensions',
      (bank) => {
        bank.robust.hellinger.feature_mean.pop()
      }
    ],
    [
      'ordered-block dimensions',
      (bank) => {
        bank.robust.ordered_blocks.feature_scale.pop()
      }
    ],
    [
      'non-positive scale',
      (bank) => {
        bank.robust.hellinger.feature_scale[0] = 0
      }
    ],
    [
      'centroid model count',
      (bank) => {
        bank.robust.hellinger.centroids.pop()
      }
    ],
    [
      'nuisance dimensions',
      (bank) => {
        bank.robust.hellinger.nuisance_basis.push([1])
      }
    ],
    [
      'environment dimensions',
      (bank) => {
        bank.robust.ordered_blocks.environment_centroids[0].pop()
      }
    ],
    [
      'missing calibration',
      (bank) => {
        delete bank.calibration['2']
      }
    ],
    [
      'NaN statistic',
      (bank) => {
        bank.robust.hellinger.feature_mean[0] = Number.NaN
      }
    ],
    [
      'infinite calibration',
      (bank) => {
        bank.calibration['1'].beta = Number.POSITIVE_INFINITY
      }
    ]
  ]

  it.each(invalidBanks)('rejects %s before activating or persisting the invalid bank', async (_label, mutate) => {
    const invalid = bankFixture(2)
    mutate(invalid)
    expect(() => validateFingerprintBank(invalid)).toThrow()
    const cached = cacheFixture()
    const storage = memoryStorage(cached)
    const remote = remoteFixture(JSON.stringify(invalid))
    const service = new FingerprintBankService(storage, remote.fetcher, () => NOW)
    await service.initialize()
    const previous = service.capture()
    await service.sync()
    expect(service.capture()).toBe(previous)
    expect(service.getSnapshot().status).not.toBe('idle')
    expect(storage.saved).toEqual({ ...cached, checkedAt: NOW })
  })

  it.each(['NaN', '1e309'])('rejects the non-finite JSON number %s', async (number) => {
    const bank = bankFixture(2)
    bank.calibration['1'].beta = 123.456789
    const raw = JSON.stringify(bank).replace('"beta":123.456789', `"beta":${number}`)
    expect(raw).toContain(`"beta":${number}`)
    const remote = remoteFixture(raw)
    const service = new FingerprintBankService(memoryStorage(), remote.fetcher, () => NOW)
    await service.sync()
    expect(service.capture()).toBe(bundledBankSnapshot)
    expect(service.getSnapshot().status).not.toBe('idle')
  })
})
