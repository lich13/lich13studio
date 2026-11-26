import { invoke } from '@tauri-apps/api/core'

import { desktopCredentialStoreAvailable, isMainTauriWindow, mobileCommand, runtimeCapabilities } from './runtime'

const PREFIX = 'lich13-secret:'
export const DESKTOP_RESET_NOTICE_STORAGE_KEY = 'lich13:desktop-credential-reset-notice'
const CREDENTIAL_SLICES = new Set([
  'llm',
  'settings',
  'backup',
  'copilot',
  'ocr',
  'openclaw',
  'codeTools',
  'preprocess',
  'nutstore',
  'websearch',
  'mcp',
  'knowledge',
  'paintings',
  'minapps',
  'translate',
  'docprocess'
])
const secretField =
  /^(?:(?:.*[_-])?api.?keys?|private.?key|.*token|.*password|.*pass|.*secret.*|authorization|x-api-key|extra_headers|credentials)$/i

export type SecretMap = Record<string, unknown>

export interface AffectedProviderCredential {
  id: string
  name: string
  apiKey: boolean
  extraHeaders: boolean
}

export interface DesktopCredentialResetNotice {
  providers: AffectedProviderCredential[]
  webdav: boolean
  clearedCount: number
}

function emptyCredentialValue(secret: unknown, field: string): unknown {
  if (Array.isArray(secret) || /^api.?keys$/i.test(field)) return []
  if ((typeof secret === 'object' && secret !== null) || /^(?:extra_headers|credentials)$/i.test(field)) return {}
  return ''
}

// Redux persist serializes each slice as JSON inside an outer JSON object.
// Walk only credential-bearing inner slices without inspecting ordinary chat or assistant payloads.
export function mapCredentials(value: unknown, visit: (value: unknown, field: string) => unknown, field = ''): unknown {
  if (secretField.test(field)) return visit(value, field)
  if (typeof value === 'string') {
    if (value.startsWith(PREFIX)) return visit(value, field)
    if ((field === '' || field === 'persist:cherry-studio' || CREDENTIAL_SLICES.has(field)) && /^\s*[[{]/.test(value)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return value
      }
      return JSON.stringify(mapCredentials(parsed, visit))
    }
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => mapCredentials(entry, visit))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapCredentials(entry, visit, key)]))
  }
  return value
}

export function stripCredentials<T>(value: T): T {
  return mapCredentials(value, emptyCredentialValue) as T
}

interface PersistedDesktopResetNotice extends DesktopCredentialResetNotice {
  clearedTokens?: string[]
}

let secrets: SecretMap = {}
let committedSecrets: SecretMap | null = null
let initialized = false
let tail = Promise.resolve()
let lastPersistError: unknown = null
let pendingDesktopResetNotice: PersistedDesktopResetNotice | null = null

const isRef = (value: unknown): value is string => typeof value === 'string' && value.startsWith(PREFIX)

function hasDanglingValue(value: unknown, known: SecretMap): boolean {
  if (isRef(value)) return !(value in known)
  if (Array.isArray(value)) return value.some((item) => hasDanglingValue(item, known))
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasDanglingValue(item, known))
  return false
}

function collectAffectedCredentials(
  rawPersisted: string,
  known: SecretMap
): Omit<DesktopCredentialResetNotice, 'clearedCount'> {
  const providers: AffectedProviderCredential[] = []
  let webdav = false
  try {
    const outer = JSON.parse(rawPersisted) as Record<string, unknown>
    if (typeof outer?.llm === 'string') {
      const llm = JSON.parse(outer.llm) as { providers?: Array<Record<string, unknown>> }
      for (const provider of Array.isArray(llm?.providers) ? llm.providers : []) {
        if (!provider || typeof provider !== 'object') continue
        const apiKey = hasDanglingValue(provider.apiKey, known) || hasDanglingValue(provider.apiKeys, known)
        const extraHeaders = hasDanglingValue(provider.extra_headers, known)
        if (apiKey || extraHeaders) {
          const id = typeof provider.id === 'string' ? provider.id : ''
          const name = typeof provider.name === 'string' && provider.name.trim() ? provider.name.trim() : id
          providers.push({ id, name, apiKey, extraHeaders })
        }
      }
    }
    for (const sliceName of ['settings', 'backup'] as const) {
      const rawSlice = outer?.[sliceName]
      if (typeof rawSlice === 'string') {
        const parsedSlice = JSON.parse(rawSlice) as Record<string, unknown>
        if (hasDanglingValue(parsedSlice?.webdavPass, known)) {
          webdav = true
        }
      }
    }
  } catch {
    // Malformed outer payloads still fall through to mapCredentials healing below.
  }
  return { providers, webdav }
}

function healDanglingDesktopState(
  rawPersisted: string,
  known: SecretMap
): {
  healed: string
  notice: PersistedDesktopResetNotice | null
} {
  if (!rawPersisted.includes(PREFIX)) {
    return { healed: rawPersisted, notice: null }
  }
  const summary = collectAffectedCredentials(rawPersisted, known)
  let clearedCount = 0
  const tokenOccurrences = new Map<string, number>()
  const clearedTokens: string[] = []
  const recordToken = (baseToken: string) => {
    const idx = tokenOccurrences.get(baseToken) ?? 0
    tokenOccurrences.set(baseToken, idx + 1)
    clearedTokens.push(`${baseToken}#${idx}`)
  }
  const healed = mapCredentials(rawPersisted, (secret, field) => {
    if (isRef(secret) && !(secret in known)) {
      clearedCount += 1
      recordToken(`${field}:${secret}`)
      return emptyCredentialValue(secret, field)
    }
    if (Array.isArray(secret)) {
      const dangling = secret.filter((entry): entry is string => isRef(entry) && !(entry in known))
      if (dangling.length > 0) {
        clearedCount += 1
        recordToken(`${field}:${[...dangling].sort().join(',')}`)
        return secret.filter((entry) => !(isRef(entry) && !(entry in known)))
      }
    }
    if (secret && typeof secret === 'object' && !Array.isArray(secret)) {
      const dangling = Object.entries(secret)
        .filter(([, v]) => isRef(v) && !(v in known))
        .map(([k, v]) => `${k}=${v}`)
      if (dangling.length > 0) {
        clearedCount += 1
        recordToken(`${field}:${dangling.sort().join(',')}`)
        return Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, isRef(v) && !(v in known) ? '' : v]))
      }
    }
    return secret
  }) as string

  if (clearedCount === 0) {
    return { healed: rawPersisted, notice: null }
  }
  return {
    healed,
    notice: {
      ...summary,
      clearedCount,
      clearedTokens
    }
  }
}

function readPersistedDesktopResetNotice(): PersistedDesktopResetNotice | null {
  try {
    const raw = localStorage.getItem(DESKTOP_RESET_NOTICE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedDesktopResetNotice>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.providers)) return null
    const clearedTokens = Array.isArray(parsed.clearedTokens)
      ? parsed.clearedTokens.filter((token): token is string => typeof token === 'string' && token.length > 0)
      : undefined
    const clearedCount =
      clearedTokens && clearedTokens.length > 0
        ? clearedTokens.length
        : typeof parsed.clearedCount === 'number' && parsed.clearedCount > 0
          ? parsed.clearedCount
          : 0
    if (clearedCount === 0) return null
    return {
      providers: parsed.providers.filter((item): item is AffectedProviderCredential =>
        Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')
      ),
      webdav: Boolean(parsed.webdav),
      clearedCount,
      ...(clearedTokens && clearedTokens.length > 0 ? { clearedTokens } : {})
    }
  } catch {
    return null
  }
}

function mergeDesktopResetNotices(
  existing: PersistedDesktopResetNotice | null,
  incoming: PersistedDesktopResetNotice
): PersistedDesktopResetNotice {
  if (!existing) return incoming
  const byKey = new Map<string, AffectedProviderCredential>()
  for (const item of [...existing.providers, ...incoming.providers]) {
    const key = item.id || item.name
    const prev = byKey.get(key)
    if (prev) {
      byKey.set(key, {
        ...prev,
        apiKey: prev.apiKey || item.apiKey,
        extraHeaders: prev.extraHeaders || item.extraHeaders
      })
    } else {
      byKey.set(key, { ...item })
    }
  }
  const mergedTokens =
    existing.clearedTokens && incoming.clearedTokens
      ? Array.from(new Set([...existing.clearedTokens, ...incoming.clearedTokens]))
      : undefined
  return {
    providers: Array.from(byKey.values()),
    webdav: existing.webdav || incoming.webdav,
    clearedCount: mergedTokens ? mergedTokens.length : existing.clearedCount + incoming.clearedCount,
    ...(mergedTokens ? { clearedTokens: mergedTokens } : {})
  }
}

function persistDesktopResetNotice(notice: PersistedDesktopResetNotice): PersistedDesktopResetNotice {
  const merged = mergeDesktopResetNotices(readPersistedDesktopResetNotice(), notice)
  try {
    localStorage.setItem(DESKTOP_RESET_NOTICE_STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // Keep in-memory notice if storage is unavailable.
  }
  return merged
}

export function consumeDesktopCredentialResetNotice(): DesktopCredentialResetNotice | null {
  if (!runtimeCapabilities.android && desktopCredentialStoreAvailable() && !isMainTauriWindow()) {
    return null
  }
  const notice = pendingDesktopResetNotice ?? readPersistedDesktopResetNotice()
  pendingDesktopResetNotice = null
  try {
    localStorage.removeItem(DESKTOP_RESET_NOTICE_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup errors.
  }
  if (!notice) return null
  return {
    providers: notice.providers,
    webdav: notice.webdav,
    clearedCount: notice.clearedCount
  }
}

function hasAllSecrets(storeMap: SecretMap | null, subset: SecretMap): boolean {
  if (!storeMap) return false
  return Object.keys(subset).every(
    (key) =>
      Object.prototype.hasOwnProperty.call(storeMap, key) &&
      JSON.stringify(storeMap[key]) === JSON.stringify(subset[key])
  )
}

function secretsEqual(left: SecretMap | null, right: SecretMap): boolean {
  if (!left) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return hasAllSecrets(left, right)
}

function hasRemovedSecrets(previous: SecretMap | null, next: SecretMap): boolean {
  if (!previous) return false
  return Object.keys(previous).some((key) => !Object.prototype.hasOwnProperty.call(next, key))
}

function containsUnresolvedRef(value: string, known: SecretMap): boolean {
  if (!value.includes(PREFIX)) return false
  let missing = false
  mapCredentials(value, (secret) => {
    if (hasDanglingValue(secret, known)) {
      missing = true
    }
    return secret
  })
  return missing
}

export function hydrateCredentials<T>(value: T): T {
  return mapCredentials(value, (secret) => {
    if (!isRef(secret)) return secret
    if (!(secret in secrets)) {
      throw new Error('Credential is unavailable; restore an encrypted backup or enter it again')
    }
    return secrets[secret]
  }) as T
}

/** True when the persisted Redux record goes through this credential-aware storage. */
export const credentialStorageEnabled = runtimeCapabilities.android || desktopCredentialStoreAvailable()

function redactState(value: string) {
  const nextSecrets: SecretMap = {}
  const refBySerializedSecret = new Map<string, string>()
  for (const [existingRef, previous] of Object.entries(secrets)) {
    const serialized = JSON.stringify(previous)
    if (serialized !== undefined && !refBySerializedSecret.has(serialized)) {
      refBySerializedSecret.set(serialized, existingRef)
    }
  }

  const redacted = mapCredentials(value, (secret) => {
    if (secret === '' || secret == null || (typeof secret === 'object' && !Object.keys(secret).length)) return secret
    const resolved = isRef(secret) ? secrets[secret] : secret
    if (resolved === undefined) throw new Error('Credential unavailable')
    const serialized = JSON.stringify(resolved)
    let ref = serialized !== undefined ? refBySerializedSecret.get(serialized) : undefined
    if (!ref) {
      ref = `${PREFIX}${crypto.randomUUID()}`
      if (serialized !== undefined) {
        refBySerializedSecret.set(serialized, ref)
      }
    }
    nextSecrets[ref] = resolved
    return ref
  }) as string
  return { redacted, nextSecrets }
}

async function readDesktopStoreMap(): Promise<SecretMap> {
  const stored = await invoke<string>('read_secure_credentials')
  const parsed = JSON.parse(stored)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Invalid secure credential store')
  }
  return parsed as SecretMap
}

// Desktop: persist into isolated `app_data_dir()/credentials.json` first, then write
// reference-only state to localStorage. Failures propagate so callers (such as
// ProviderImportHandler via assertPersistCommitted) roll back cleanly without
// leaking plaintext keys into WebView localStorage.
async function saveDesktopState(key: string, value: string, prune: boolean) {
  const { redacted, nextSecrets } = redactState(value)
  const shouldPrune = prune && key === 'persist:cherry-studio'
  const allPresent = hasAllSecrets(committedSecrets, nextSecrets)
  const removed = hasRemovedSecrets(committedSecrets, nextSecrets)
  if (allPresent && (!shouldPrune || !removed)) {
    localStorage.setItem(key, redacted)
    return
  }

  const previousSecrets = secrets
  const previousCommitted = committedSecrets
  const previousState = localStorage.getItem(key)

  if (!allPresent) {
    await invoke('write_secure_credentials', { value: JSON.stringify(nextSecrets), replace: false })
    const mergedSecrets = { ...(committedSecrets ?? secrets), ...nextSecrets }
    secrets = mergedSecrets
    committedSecrets = mergedSecrets
  }

  try {
    localStorage.setItem(key, redacted)
  } catch (error) {
    secrets = previousSecrets
    committedSecrets = previousCommitted
    throw error
  }

  if (shouldPrune && hasRemovedSecrets(committedSecrets, nextSecrets)) {
    try {
      await invoke('write_secure_credentials', { value: JSON.stringify(nextSecrets), replace: true })
      secrets = { ...nextSecrets }
      committedSecrets = { ...nextSecrets }
    } catch (error) {
      secrets = previousSecrets
      committedSecrets = previousCommitted
      if (previousState === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previousState)
      throw error
    }
  }
}

async function initializeDesktopCredentials() {
  const parsed = await readDesktopStoreMap()
  secrets = parsed
  committedSecrets = { ...parsed }
  const isMain = isMainTauriWindow()
  if (isMain) {
    pendingDesktopResetNotice = readPersistedDesktopResetNotice()
  }

  const old = localStorage.getItem('persist:cherry-studio')
  if (old) {
    const { healed, notice } = healDanglingDesktopState(old, secrets)
    if (notice) {
      const mergedNotice = persistDesktopResetNotice(notice)
      if (isMain) {
        pendingDesktopResetNotice = mergedNotice
        localStorage.setItem('persist:cherry-studio', healed)
      }
    }
    // MiniWindow never mutates persist:cherry-studio or credentials.json; MainWindow owns migration and pruning.
    if (isMain) {
      await saveDesktopState('persist:cherry-studio', healed, true)
    }
  }
  initialized = true
}

async function savePrivateState(key: string, value: string) {
  const { redacted, nextSecrets } = redactState(value)
  const unchanged =
    key === 'persist:cherry-studio'
      ? secretsEqual(committedSecrets, nextSecrets)
      : hasAllSecrets(committedSecrets, nextSecrets)
  if (unchanged) {
    localStorage.setItem(key, redacted)
    return
  }
  const previousSecrets = secrets
  const mergedSecrets = { ...(committedSecrets ?? secrets), ...nextSecrets }
  // Commit the secure copy first; a failure leaves the previous state readable.
  await mobileCommand('writeCredentials', { value: JSON.stringify(mergedSecrets) })
  secrets = mergedSecrets
  committedSecrets = mergedSecrets
  const previousState = localStorage.getItem(key)
  localStorage.setItem(key, redacted)
  // Prune stale keys only when persist:cherry-studio actually dropped secret references.
  if (key === 'persist:cherry-studio' && hasRemovedSecrets(mergedSecrets, nextSecrets)) {
    try {
      await mobileCommand('writeCredentials', { value: JSON.stringify(nextSecrets) })
      secrets = { ...nextSecrets }
      committedSecrets = { ...nextSecrets }
    } catch (error) {
      secrets = { ...previousSecrets, ...nextSecrets }
      if (previousState === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previousState)
      throw error
    }
  }
}

export async function initializeMobileCredentials() {
  if (initialized) return
  if (!runtimeCapabilities.android) {
    if (desktopCredentialStoreAvailable()) await initializeDesktopCredentials()
    return
  }
  const result = await mobileCommand<{ value: string }>('readCredentials')
  const parsed = JSON.parse(result.value)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid secure credential store')
  secrets = parsed
  committedSecrets = { ...parsed }
  const old = localStorage.getItem('persist:cherry-studio')
  if (old) await savePrivateState('persist:cherry-studio', old)
  initialized = true
}

export async function assertPersistCommitted(): Promise<void> {
  await tail
  if (lastPersistError !== null) {
    const error = lastPersistError
    lastPersistError = null
    throw error instanceof Error ? error : new Error('Failed to persist credentials')
  }
}

export const mobilePersistStorage = {
  async getItem(key: string) {
    await initializeMobileCredentials()
    const value = localStorage.getItem(key)
    if (value === null) return null
    if (!runtimeCapabilities.android && desktopCredentialStoreAvailable() && containsUnresolvedRef(value, secrets)) {
      const refreshed = await readDesktopStoreMap()
      secrets = refreshed
      committedSecrets = { ...refreshed }
      if (key === 'persist:cherry-studio' && containsUnresolvedRef(value, secrets)) {
        const { healed, notice } = healDanglingDesktopState(value, secrets)
        if (notice) {
          const mergedNotice = persistDesktopResetNotice(notice)
          if (isMainTauriWindow()) {
            pendingDesktopResetNotice = mergedNotice
            localStorage.setItem('persist:cherry-studio', healed)
          }
        }
        return hydrateCredentials(healed)
      }
    }
    return hydrateCredentials(value)
  },
  setItem(key: string, value: string) {
    const write = tail
      .then(async () => {
        await initializeMobileCredentials()
        if (runtimeCapabilities.android) await savePrivateState(key, value)
        else await saveDesktopState(key, value, false)
        if (key === 'persist:cherry-studio') {
          lastPersistError = null
        }
      })
      .catch((error) => {
        if (key === 'persist:cherry-studio') {
          lastPersistError = error
        }
        throw error
      })
    tail = write.catch(() => {})
    return write
  },
  async removeItem(key: string) {
    await tail
    localStorage.removeItem(key)
    if (key === 'persist:cherry-studio') {
      pendingDesktopResetNotice = null
      localStorage.removeItem(DESKTOP_RESET_NOTICE_STORAGE_KEY)
      if (runtimeCapabilities.android) await mobileCommand('clearCredentials')
      else if (desktopCredentialStoreAvailable()) await invoke('clear_secure_credentials')
      secrets = {}
      committedSecrets = {}
    }
  }
}
