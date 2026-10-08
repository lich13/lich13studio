import { mobileCommand, runtimeCapabilities } from './runtime'

const PREFIX = 'lich13-secret:'
const secretField =
  /^(?:api.?keys?|.*token|.*password|.*pass|.*secret.*|authorization|x-api-key|extra_headers|credentials)$/i
export type SecretMap = Record<string, unknown>

// Redux persist serializes each slice as JSON inside an outer JSON object.
// Walk both levels without inspecting or changing ordinary text values.
export function mapCredentials(value: unknown, visit: (value: unknown) => unknown, field = ''): unknown {
  if (secretField.test(field)) return visit(value)
  if (typeof value === 'string') {
    if (value.startsWith(PREFIX)) return visit(value)
    if (
      (field === '' ||
        field === 'persist:cherry-studio' ||
        ['llm', 'settings', 'backup', 'copilot', 'ocr', 'openclaw', 'codeTools'].includes(field)) &&
      /^\s*[[{]/.test(value)
    ) {
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
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapCredentials(entry, visit, key)]))
  return value
}
export function stripCredentials<T>(value: T): T {
  return mapCredentials(value, (secret) =>
    typeof secret === 'object' && secret !== null ? (Array.isArray(secret) ? [] : {}) : ''
  ) as T
}

let secrets: SecretMap = {}
let initialized = false
let tail = Promise.resolve()
const isRef = (value: unknown): value is string => typeof value === 'string' && value.startsWith(PREFIX)
export function hydrateCredentials<T>(value: T): T {
  return mapCredentials(value, (secret) => {
    if (!isRef(secret)) return secret
    if (!(secret in secrets))
      throw new Error('Credential is unavailable; restore an encrypted backup or enter it again')
    return secrets[secret]
  }) as T
}

async function savePrivateState(key: string, value: string) {
  const nextSecrets: SecretMap = {}
  const oldEntries = Object.entries(secrets)
  const redacted = mapCredentials(value, (secret) => {
    if (secret === '' || secret == null || (typeof secret === 'object' && !Object.keys(secret).length)) return secret
    const resolved = isRef(secret) ? secrets[secret] : secret
    if (resolved === undefined) throw new Error('Credential unavailable')
    const ref =
      oldEntries.find(([, previous]) => JSON.stringify(previous) === JSON.stringify(resolved))?.[0] ||
      `${PREFIX}${crypto.randomUUID()}`
    nextSecrets[ref] = resolved
    return ref
  }) as string
  // Commit the secure copy first; a failure leaves the previous state readable.
  await mobileCommand('writeCredentials', { value: JSON.stringify({ ...secrets, ...nextSecrets }) })
  secrets = { ...secrets, ...nextSecrets }
  const previousState = localStorage.getItem(key)
  localStorage.setItem(key, redacted)
  // The only credential-bearing local record is persist:cherry-studio.
  if (key === 'persist:cherry-studio') {
    try {
      await mobileCommand('writeCredentials', { value: JSON.stringify(nextSecrets) })
      secrets = nextSecrets
    } catch (error) {
      if (previousState === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previousState)
      throw error
    }
  }
}

export async function initializeMobileCredentials() {
  if (!runtimeCapabilities.android || initialized) return
  const result = await mobileCommand<{ value: string }>('readCredentials')
  const parsed = JSON.parse(result.value)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid secure credential store')
  secrets = parsed
  const old = localStorage.getItem('persist:cherry-studio')
  if (old) await savePrivateState('persist:cherry-studio', old)
  initialized = true
}

export const mobilePersistStorage = {
  async getItem(key: string) {
    await initializeMobileCredentials()
    const value = localStorage.getItem(key)
    return value === null ? null : hydrateCredentials(value)
  },
  setItem(key: string, value: string) {
    const write = tail.then(async () => {
      await initializeMobileCredentials()
      await savePrivateState(key, value)
    })
    tail = write.catch(() => {})
    return write
  },
  async removeItem(key: string) {
    await tail
    localStorage.removeItem(key)
    if (key === 'persist:cherry-studio') {
      await mobileCommand('clearCredentials')
      secrets = {}
    }
  }
}
