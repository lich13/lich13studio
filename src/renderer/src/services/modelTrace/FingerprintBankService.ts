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
export const FINGERPRINT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
export const FINGERPRINT_PUBLIC_REQUEST_TIMEOUT_MS = 15 * 1000
export const FINGERPRINT_SYNC_ROUND_TIMEOUT_MS = 60 * 1000

const MAX_BYTES = 8 * 1024 * 1024
const HASH = /^[a-f0-9]{40}$/

export type FingerprintBankSyncError = 'network' | 'timeout' | 'rate-limit' | 'cache' | 'invalid-data' | 'incompatible'

export type FingerprintBankSyncResult = 'up-to-date' | 'updated' | 'failed'

export interface FingerprintBankCache {
  rawBank: string
  version: FingerprintBankSnapshot['version']
  coreBlob: string
  challengeBlob: string
  checkedAt: number
  syncedAt: number
  /** The next time an automatic retry is allowed after a transient failure. */
  cooldownUntil?: number
}

export interface FingerprintBankStorage {
  read(): Promise<FingerprintBankCache | undefined>
  write(value: FingerprintBankCache): Promise<void>
}

type FingerprintCacheDatabase = Dexie & { entries: EntityTable<{ id: string; value: FingerprintBankCache }, 'id'> }

class BankCache implements FingerprintBankStorage {
  private database?: FingerprintCacheDatabase

  private getDatabase() {
    if (!this.database) {
      this.database = new Dexie('lich13studio-modeltrace-cache') as FingerprintCacheDatabase
      this.database.version(1).stores({ entries: '&id' })
    }
    return this.database
  }

  async read() {
    return (await this.getDatabase().entries.get('active'))?.value
  }

  async write(value: FingerprintBankCache) {
    await this.getDatabase().entries.put({ id: 'active', value })
  }
}

export interface FingerprintBankState {
  active: FingerprintBankSnapshot
  source: 'bundled' | 'cache' | 'remote'
  status: 'idle' | 'checking' | 'error' | 'upgrade-required'
  checkedAt?: number
  syncedAt?: number
  cooldownUntil?: number
  result?: FingerprintBankSyncResult
  error?: FingerprintBankSyncError
}

class FingerprintSyncFailure extends Error {
  constructor(
    readonly code: FingerprintBankSyncError,
    message: string,
    readonly retryAt?: number
  ) {
    super(message)
    this.name = 'FingerprintSyncFailure'
  }
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

function isTransient(error: unknown) {
  return error instanceof FingerprintSyncFailure && (error.code === 'network' || error.code === 'timeout')
}

function safeError(error: unknown, fallback: FingerprintBankSyncError): FingerprintSyncFailure {
  if (error instanceof FingerprintSyncFailure) return error
  if (error instanceof IncompatibleFingerprintBankError) {
    return new FingerprintSyncFailure('incompatible', 'upstream fingerprint data is incompatible')
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new FingerprintSyncFailure('timeout', 'public fingerprint request timed out')
  }
  return new FingerprintSyncFailure(fallback, 'public fingerprint request failed')
}

function parseRetryAt(headers: Headers, now: number) {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return date
  }
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) return reset * 1000
  return undefined
}

function parseGitUploadPackRefs(bytes: Uint8Array, branch: string) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const lines: string[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new FingerprintSyncFailure('invalid-data', 'invalid git refs response')
    const length = Number.parseInt(new TextDecoder().decode(bytes.slice(offset, offset + 4)), 16)
    if (!Number.isFinite(length) || length < 0 || (length > 0 && length < 4) || offset + length > bytes.length) {
      throw new FingerprintSyncFailure('invalid-data', 'invalid git refs packet')
    }
    if (length >= 4) lines.push(decoder.decode(bytes.slice(offset + 4, offset + length)))
    offset += length || 4
  }

  const expected = new RegExp(
    `^([a-f0-9]{40}) refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\0|[ \t]|$)`
  )
  const matches = lines
    .map((line) => line.replace(/[\r\n].*$/, ''))
    .map((line) => expected.exec(line)?.[1])
    .filter((value): value is string => Boolean(value))

  if (matches.length !== 1) throw new FingerprintSyncFailure('invalid-data', 'git branch ref was not found')
  return matches[0]
}

type RemoteReadOptions = {
  accept?: string
}

type RemoteFiles = {
  core: Uint8Array
  challenge: Uint8Array
  bank: Uint8Array
}

export class FingerprintBankService {
  private state: FingerprintBankState = { active: bundledBankSnapshot, source: 'bundled', status: 'idle' }
  private listeners = new Set<() => void>()
  private initialization?: Promise<void>
  private pending?: Promise<void>
  private roundDeadline = 0
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
    return () => this.listeners.delete(listener)
  }

  private update(changes: Partial<FingerprintBankState>) {
    this.state = { ...this.state, ...changes }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // Subscriber failures must never enter the provider error path.
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
          (cached.cooldownUntil !== undefined && !Number.isFinite(cached.cooldownUntil)) ||
          cached.checkedAt < 0 ||
          cached.syncedAt < 0 ||
          !HASH.test(cached.version.revision) ||
          typeof cached.rawBank !== 'string' ||
          cached.rawBank.length > MAX_BYTES
        ) {
          throw new IncompatibleFingerprintBankError()
        }
        const bytes = new TextEncoder().encode(cached.rawBank)
        if ((await fingerprintDigest(bytes)) !== cached.version.sha256) throw new Error('Invalid cache digest')
        const bank: unknown = JSON.parse(cached.rawBank)
        validateFingerprintBank(bank)
        if (
          bank.built_at !== cached.version.builtAt ||
          Date.parse(bank.built_at) < Date.parse(bundledBankSnapshot.bank.built_at)
        ) {
          return
        }
        this.cached = cached
        this.update({
          active: freezeBankSnapshot({ bank, version: cached.version }),
          source: 'cache',
          checkedAt: cached.checkedAt,
          syncedAt: cached.syncedAt,
          cooldownUntil: cached.cooldownUntil
        })
      } catch {
        // Corrupt or unavailable cache never prevents a test using the bundled bank.
      }
    })()
    return this.initialization
  }

  private async readRemote(url: string, options: RemoteReadOptions = {}): Promise<Uint8Array> {
    const controller = new AbortController()
    const remaining = this.roundDeadline > 0 ? this.roundDeadline - this.now() : FINGERPRINT_SYNC_ROUND_TIMEOUT_MS
    const timeout = Math.min(FINGERPRINT_PUBLIC_REQUEST_TIMEOUT_MS, Math.max(1, remaining))
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new FingerprintSyncFailure('timeout', 'public fingerprint request timed out'))
      }, timeout)
    })
    try {
      let response: Response
      try {
        response = await Promise.race([
          this.fetcher(url, {
            signal: controller.signal,
            credentials: 'omit',
            headers: {
              Accept: options.accept ?? 'application/vnd.github+json',
              'User-Agent': 'lich13studio-modeltrace'
            }
          }),
          timeoutPromise
        ])
      } catch (error) {
        if (error instanceof FingerprintSyncFailure) throw error
        if (controller.signal.aborted)
          throw new FingerprintSyncFailure('timeout', 'public fingerprint request timed out')
        throw new FingerprintSyncFailure('network', 'public fingerprint request failed')
      }

      if (!response.ok) {
        const retryAt = parseRetryAt(response.headers, this.now())
        if (response.status === 403 || response.status === 429) {
          throw new FingerprintSyncFailure('rate-limit', 'GitHub rate limit reached', retryAt)
        }
        if (response.status === 408 || response.status === 504) {
          throw new FingerprintSyncFailure('timeout', 'public fingerprint request timed out')
        }
        if (response.status >= 500) throw new FingerprintSyncFailure('network', 'public fingerprint server unavailable')
        throw new FingerprintSyncFailure('invalid-data', 'public fingerprint source changed')
      }

      const lengthHeader = Number(response.headers.get('content-length') || 0)
      if (lengthHeader > MAX_BYTES) {
        await response.body?.cancel().catch(() => {})
        throw new FingerprintSyncFailure('invalid-data', 'public fingerprint payload is too large')
      }
      const reader = response.body?.getReader()
      if (!reader) return new Uint8Array()
      const pieces: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue
          length += value.length
          if (length > MAX_BYTES) {
            controller.abort()
            throw new FingerprintSyncFailure('invalid-data', 'public fingerprint payload is too large')
          }
          pieces.push(value)
        }
      } catch (error) {
        if (error instanceof FingerprintSyncFailure) throw error
        if (controller.signal.aborted)
          throw new FingerprintSyncFailure('timeout', 'public fingerprint request timed out')
        throw new FingerprintSyncFailure('network', 'public fingerprint connection interrupted')
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
      if (timer) clearTimeout(timer)
    }
  }

  private async readRemoteWithRetry(url: string, options?: RemoteReadOptions) {
    let lastError: unknown
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        return await this.readRemote(url, options)
      } catch (error) {
        lastError = error
        if (!isTransient(error) || attempt === 1) throw error
      }
    }
    throw lastError
  }

  private async readApiHead(base: string) {
    const bytes = await this.readRemoteWithRetry(`${base}/commits/${manifest.branch}`)
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new FingerprintSyncFailure('invalid-data', 'invalid GitHub revision response')
    }
    const sha = (value as { sha?: unknown })?.sha
    if (typeof sha !== 'string' || !HASH.test(sha)) {
      throw new FingerprintSyncFailure('invalid-data', 'invalid upstream revision')
    }
    return sha
  }

  private async readGitHead() {
    const url = `https://github.com/${manifest.repository}.git/info/refs?service=git-upload-pack`
    const bytes = await this.readRemoteWithRetry(url, { accept: 'application/x-git-upload-pack-advertisement' })
    return parseGitUploadPackRefs(bytes, manifest.branch)
  }

  private async readApiTree(base: string, revision: string) {
    const bytes = await this.readRemoteWithRetry(`${base}/git/trees/${revision}?recursive=1`)
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
        truncated?: boolean
        tree?: Array<{ path: string; type: string; mode: string; sha?: string }>
      }
    } catch {
      throw new FingerprintSyncFailure('invalid-data', 'invalid upstream tree response')
    }
  }

  private async readPinnedFile(revision: string, path: string) {
    const urls = [
      `https://raw.githubusercontent.com/${manifest.repository}/${revision}/${path}`,
      `https://github.com/${manifest.repository}/raw/${revision}/${path}`
    ]
    let lastError: unknown
    for (const [index, url] of urls.entries()) {
      try {
        return await this.readRemoteWithRetry(url, { accept: 'text/plain' })
      } catch (error) {
        lastError = error
        if (index === urls.length - 1 || !isTransient(error)) throw error
      }
    }
    throw lastError
  }

  private async readFallbackFiles(revision: string): Promise<RemoteFiles> {
    const core = await this.readPinnedFile(revision, manifest.files.core.path)
    const challenge = await this.readPinnedFile(revision, manifest.files.challenge.path)
    const bank = await this.readPinnedFile(revision, manifest.files.bank.path)
    if ((await gitBlobDigest(core)) !== manifest.files.core.gitBlob) {
      throw new IncompatibleFingerprintBankError()
    }
    if ((await gitBlobDigest(challenge)) !== manifest.files.challenge.gitBlob) {
      throw new IncompatibleFingerprintBankError()
    }
    return { core, challenge, bank }
  }

  private async writeCheckTime(now: number) {
    const next: FingerprintBankCache = { ...this.cached, checkedAt: now }
    delete next.cooldownUntil
    try {
      await this.storage.write(next)
      this.cached = next
      return true
    } catch {
      this.update({ status: 'error', error: 'cache', result: 'failed', checkedAt: now })
      return false
    }
  }

  private async persistFailure(now: number, failure: FingerprintSyncFailure) {
    const transient = failure.code === 'network' || failure.code === 'timeout' || failure.code === 'rate-limit'
    const cooldownUntil = transient ? Math.max(now + FINGERPRINT_FAILURE_COOLDOWN_MS, failure.retryAt ?? 0) : undefined
    const next: FingerprintBankCache =
      cooldownUntil === undefined
        ? { ...this.cached, checkedAt: now }
        : { ...this.cached, checkedAt: now, cooldownUntil }
    try {
      await this.storage.write(next)
      this.cached = next
    } catch {
      // The active in-memory bank remains usable even if IndexedDB is unavailable.
    }
    this.update({
      status: failure.code === 'incompatible' ? 'upgrade-required' : 'error',
      error: failure.code,
      result: 'failed',
      checkedAt: now,
      cooldownUntil
    })
  }

  sync(force = false): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.synchronize(force).finally(() => {
      this.pending = undefined
      this.roundDeadline = 0
    })
    return this.pending
  }

  private async synchronize(force: boolean) {
    await this.initialize()
    const now = this.now()
    const { checkedAt, error, cooldownUntil } = this.state
    if (!force && checkedAt !== undefined && now >= checkedAt) {
      if (error && cooldownUntil !== undefined && now < cooldownUntil) return
      if (!error && now - checkedAt < FINGERPRINT_SYNC_INTERVAL_MS) return
    }

    this.roundDeadline = now + FINGERPRINT_SYNC_ROUND_TIMEOUT_MS
    this.update({ status: 'checking', error: undefined, result: undefined })
    let stage: 'network' | 'invalid-data' = 'network'
    try {
      const base = `https://api.github.com/repos/${manifest.repository}`
      let revision: string
      let apiHead = true
      try {
        revision = await this.readApiHead(base)
      } catch (error) {
        const failure = safeError(error, 'network')
        if (!isTransient(failure) && failure.code !== 'rate-limit') throw failure
        apiHead = false
        revision = await this.readGitHead()
      }

      if (revision === this.state.active.version.revision) {
        await this.writeCheckTime(now)
        if (this.state.error !== 'cache') {
          this.update({
            status: 'idle',
            checkedAt: now,
            syncedAt: this.state.syncedAt,
            cooldownUntil: undefined,
            result: 'up-to-date',
            error: undefined
          })
        }
        return
      }

      let bankBytes: Uint8Array
      let expectedBankBlob: string
      if (!apiHead) {
        const files = await this.readFallbackFiles(revision)
        bankBytes = files.bank
        expectedBankBlob = await gitBlobDigest(bankBytes)
      } else {
        try {
          const tree = await this.readApiTree(base, revision)
          stage = 'invalid-data'
          if (tree.truncated || !Array.isArray(tree.tree)) {
            throw new FingerprintSyncFailure('invalid-data', 'incomplete upstream tree')
          }
          const blob = (path: string) =>
            tree.tree?.find((entry) => entry.path === path && entry.type === 'blob' && entry.mode === '100644')?.sha
          if (
            blob(manifest.files.core.path) !== manifest.files.core.gitBlob ||
            blob(manifest.files.challenge.path) !== manifest.files.challenge.gitBlob
          ) {
            throw new IncompatibleFingerprintBankError()
          }
          expectedBankBlob = blob(manifest.files.bank.path) ?? ''
          if (!HASH.test(expectedBankBlob)) {
            throw new FingerprintSyncFailure('invalid-data', 'upstream fingerprint bank is missing')
          }
          stage = 'network'
          bankBytes = await this.readPinnedFile(revision, manifest.files.bank.path)
        } catch (error) {
          const failure = safeError(error, stage)
          if (!isTransient(failure) && failure.code !== 'rate-limit') throw failure
          const files = await this.readFallbackFiles(revision)
          bankBytes = files.bank
          expectedBankBlob = await gitBlobDigest(bankBytes)
        }
      }

      stage = 'invalid-data'
      if ((await gitBlobDigest(bankBytes)) !== expectedBankBlob) {
        throw new FingerprintSyncFailure('invalid-data', 'fingerprint bank digest mismatch')
      }
      const rawBank = new TextDecoder('utf-8', { fatal: true }).decode(bankBytes)
      const bank: unknown = JSON.parse(rawBank)
      validateFingerprintBank(bank)
      if (Date.parse(bank.built_at) < Date.parse(this.state.active.bank.built_at)) {
        throw new IncompatibleFingerprintBankError()
      }

      const version = {
        revision,
        sha256: await fingerprintDigest(bankBytes),
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
        this.update({ status: 'error', error: 'cache', result: 'failed', checkedAt: now })
        return
      }
      this.cached = next
      this.update({
        active: freezeBankSnapshot({ bank, version }),
        source: 'remote',
        status: 'idle',
        checkedAt: now,
        syncedAt: next.syncedAt,
        cooldownUntil: undefined,
        result: 'updated',
        error: undefined
      })
    } catch (error) {
      const failure = safeError(error, stage)
      await this.persistFailure(this.now(), failure)
    }
  }

  start(): () => void {
    void this.sync()
    const timer = setInterval(() => void this.sync(), FINGERPRINT_FAILURE_COOLDOWN_MS)
    const onOnline = () => void this.sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      document.addEventListener('visibilitychange', onVisible)
    }
    return () => {
      clearInterval(timer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  }
}

export const fingerprintBankService = new FingerprintBankService()
