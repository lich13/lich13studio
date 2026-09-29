import { getTauriNativeFetch } from '@renderer/utils/tauriNativeFetch'
import Dexie, { type EntityTable } from 'dexie'

import {
  bundledBankSnapshot,
  bundledRaw,
  type FingerprintBankSnapshot,
  freezeBankSnapshot,
  IncompatibleFingerprintBankError,
  modelTraceManifest as manifest,
  validateFingerprintBank
} from './fingerprintBank'

export const FINGERPRINT_SYNC_INTERVAL_MS = 60 * 60 * 1000
const MAX_BYTES = 8 * 1024 * 1024
const HASH = /^[a-f0-9]{40}$/

export interface FingerprintBankCache {
  rawBank: string
  version: FingerprintBankSnapshot['version']
  coreBlob: string
  challengeBlob: string
  checkedAt: number
  syncedAt: number
}

export interface FingerprintBankStorage {
  read(): Promise<FingerprintBankCache | undefined>
  write(value: FingerprintBankCache): Promise<void>
}

// This disposable database is separate from CherryStudio and its backups.
type FingerprintCacheDatabase = Dexie & { entries: EntityTable<{ id: string; value: FingerprintBankCache }, 'id'> }
class BankCache implements FingerprintBankStorage {
  private database?: FingerprintCacheDatabase
  private getDatabase() {
    if (!this.database) {
      this.database = new Dexie('lich13studio-modeltrace-cache') as FingerprintCacheDatabase
      this.database!.version(1).stores({ entries: '&id' })
    }
    return this.database!
  }
  async read() {
    return (await this.getDatabase().entries.get('active'))?.value
  }
  async write(value: FingerprintBankCache) {
    // A single IndexedDB transaction replaces the data and provenance together.
    await this.getDatabase().entries.put({ id: 'active', value })
  }
}

export interface FingerprintBankState {
  active: FingerprintBankSnapshot
  source: 'bundled' | 'cache' | 'remote'
  status: 'idle' | 'checking' | 'error' | 'upgrade-required'
  checkedAt?: number
  syncedAt?: number
  error?: 'network' | 'cache' | 'invalid-data' | 'incompatible'
}

export async function fingerprintDigest(bytes: Uint8Array, algorithm = 'SHA-256'): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new Uint8Array(bytes).buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function gitBlobDigest(bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix)
  input.set(bytes, prefix.length)
  return fingerprintDigest(input, 'SHA-1')
}

export class FingerprintBankService {
  private state: FingerprintBankState = { active: bundledBankSnapshot, source: 'bundled', status: 'idle' }
  private listeners = new Set<() => void>()
  private initialization?: Promise<void>
  private pending?: Promise<void>
  private cached: FingerprintBankCache = {
    rawBank: bundledRaw,
    version: bundledBankSnapshot.version,
    coreBlob: manifest.files.core.gitBlob,
    challengeBlob: manifest.files.challenge.gitBlob,
    checkedAt: 0,
    syncedAt: 0
  }

  constructor(
    private readonly storage: FingerprintBankStorage = new BankCache(),
    private readonly fetcher: typeof fetch = (input, init) => (getTauriNativeFetch() ?? fetch)(input, init),
    private readonly now: () => number = Date.now
  ) {}

  getSnapshot = () => this.state
  capture = () => this.state.active
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(changes: Partial<FingerprintBankState>) {
    this.state = { ...this.state, ...changes }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* A view cannot break cache or synchronization. */
      }
    }
  }

  initialize(): Promise<void> {
    this.initialization ??= (async () => {
      try {
        const cached = await this.storage.read()
        if (!cached) return
        if (
          cached.coreBlob !== manifest.files.core.gitBlob ||
          cached.challengeBlob !== manifest.files.challenge.gitBlob ||
          cached.version.analyzerVersion !== manifest.analyzerVersion ||
          !Number.isFinite(cached.checkedAt) ||
          !Number.isFinite(cached.syncedAt) ||
          cached.checkedAt < 0 ||
          cached.syncedAt < 0 ||
          !HASH.test(cached.version.revision) ||
          typeof cached.rawBank !== 'string' ||
          cached.rawBank.length > MAX_BYTES
        )
          throw new IncompatibleFingerprintBankError()
        const bytes = new TextEncoder().encode(cached.rawBank)
        if ((await fingerprintDigest(bytes)) !== cached.version.sha256) throw new Error('Invalid cache digest')
        const bank: unknown = JSON.parse(cached.rawBank)
        validateFingerprintBank(bank)
        if (
          bank.built_at !== cached.version.builtAt ||
          Date.parse(bank.built_at) < Date.parse(bundledBankSnapshot.bank.built_at)
        )
          return
        this.cached = cached
        this.update({
          active: freezeBankSnapshot({ bank, version: cached.version }),
          source: 'cache',
          checkedAt: cached.checkedAt,
          syncedAt: cached.syncedAt
        })
      } catch {
        // Corrupt/unavailable cache never prevents a test using the bundled bank.
      }
    })()
    return this.initialization
  }

  private async readRemote(url: string): Promise<Uint8Array> {
    const controller = new AbortController()
    // This limit applies only to public update downloads, never model requests.
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await this.fetcher(url, {
        signal: controller.signal,
        credentials: 'omit',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lich13studio-modeltrace' }
      })
      if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_BYTES) {
        controller.abort()
        await response.body?.cancel().catch(() => {})
        throw new Error(response.ok ? 'Response too large' : `HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) return new Uint8Array()
      const pieces: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.length
          if (length > MAX_BYTES) {
            controller.abort()
            throw new Error('Response too large')
          }
          pieces.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const piece of pieces) {
        bytes.set(piece, offset)
        offset += piece.length
      }
      return bytes
    } finally {
      clearTimeout(timer)
    }
  }

  sync(force = false): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.synchronize(force).finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async synchronize(force: boolean) {
    await this.initialize()
    const now = this.now()
    if (
      !force &&
      this.state.checkedAt !== undefined &&
      now >= this.state.checkedAt &&
      now - this.state.checkedAt < FINGERPRINT_SYNC_INTERVAL_MS
    )
      return
    this.update({ status: 'checking', error: undefined })
    let stage: 'network' | 'invalid-data' = 'network'
    try {
      const base = `https://api.github.com/repos/${manifest.repository}`
      const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes))
      const head = decode(await this.readRemote(`${base}/commits/${manifest.branch}`))
      if (!HASH.test(head.sha)) throw new Error('Invalid upstream revision')
      const tree = decode(await this.readRemote(`${base}/git/trees/${head.sha}?recursive=1`))
      stage = 'invalid-data'
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete upstream tree')
      const blob = (path: string) =>
        tree.tree.find(
          (entry: { path: string; type: string; mode: string }) =>
            entry.path === path && entry.type === 'blob' && entry.mode === '100644'
        )?.sha
      if (
        blob(manifest.files.core.path) !== manifest.files.core.gitBlob ||
        blob(manifest.files.challenge.path) !== manifest.files.challenge.gitBlob
      )
        throw new IncompatibleFingerprintBankError()
      const expectedBlob = blob(manifest.files.bank.path)
      if (!HASH.test(expectedBlob || '')) throw new Error('Missing bank')
      stage = 'network'
      const bytes = await this.readRemote(
        `https://raw.githubusercontent.com/${manifest.repository}/${head.sha}/${manifest.files.bank.path}`
      )
      stage = 'invalid-data'
      if ((await gitBlobDigest(bytes)) !== expectedBlob) throw new Error('Invalid bank digest')
      const rawBank = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const bank: unknown = JSON.parse(rawBank)
      validateFingerprintBank(bank)
      if (Date.parse(bank.built_at) < Date.parse(this.state.active.bank.built_at))
        throw new IncompatibleFingerprintBankError()
      const version = {
        revision: head.sha,
        sha256: await fingerprintDigest(bytes),
        builtAt: bank.built_at,
        analyzerVersion: manifest.analyzerVersion
      }
      const next: FingerprintBankCache = {
        rawBank,
        version,
        coreBlob: manifest.files.core.gitBlob,
        challengeBlob: manifest.files.challenge.gitBlob,
        checkedAt: now,
        syncedAt: this.now()
      }
      try {
        await this.storage.write(next)
      } catch {
        this.update({ status: 'error', error: 'cache', checkedAt: now })
        return
      }
      this.cached = next
      this.update({
        active: freezeBankSnapshot({ bank, version }),
        source: 'remote',
        status: 'idle',
        checkedAt: now,
        syncedAt: next.syncedAt,
        error: undefined
      })
    } catch (error) {
      // Persist only the check timestamp on failure, retaining all last-good bytes.
      if (this.cached) {
        const next = { ...this.cached, checkedAt: now }
        try {
          await this.storage.write(next)
          this.cached = next
        } catch {
          /* Keep in-memory last-good data. */
        }
      }
      const incompatible = error instanceof IncompatibleFingerprintBankError
      this.update({
        status: incompatible ? 'upgrade-required' : 'error',
        error: incompatible ? 'incompatible' : stage,
        checkedAt: now
      })
    }
  }

  start(): () => void {
    void this.sync()
    const timer = setInterval(() => {
      void this.sync()
    }, FINGERPRINT_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }
}

export const fingerprintBankService = new FingerprintBankService()
