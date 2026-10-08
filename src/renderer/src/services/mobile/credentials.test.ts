import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CredentialsModule from './credentials'

const native = vi.hoisted(() => ({
  android: true,
  secureJson: '{}',
  writeCount: 0,
  failAtWrite: 0,
  command: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
}))

vi.mock('./runtime', () => ({
  mobileCommand: native.command,
  runtimeCapabilities: {
    get android() {
      return native.android
    }
  }
}))

const PERSIST_KEY = 'persist:cherry-studio'
const REF_PREFIX = 'lich13-secret:'
const chatBodies = [
  '{ "apiKey": "user-quoted-key", "Authorization": "user-quoted-auth" }',
  '  {\n  "password": "user-quoted-password"\n}\n',
  '[{"apiKey":"user-quoted-key"}]',
  '{"extra_headers":{"X-User-Example":"user-quoted-header"}}',
  '{"apiKey": "unfinished user input"',
  '```json\n{"apiKey":"user-quoted-key"}\n```'
]

function createState() {
  return {
    llm: {
      providers: [
        {
          id: 'provider-a',
          apiHost: 'https://provider-a.invalid',
          apiKey: 'fixture-provider-a-key',
          extra_headers: { 'X-Custom-Auth': 'fixture-provider-a-header', 'X-Region': 'fixture-region' }
        },
        {
          id: 'provider-b',
          apiHost: 'https://provider-b.invalid',
          apiKey: 'fixture-provider-b-key',
          extra_headers: { 'X-Custom-Auth': 'fixture-provider-b-header' }
        }
      ],
      defaultModel: { id: 'gpt-6.1-sol', provider: 'provider-a' }
    },
    settings: {
      webdavHost: 'https://webdav.invalid',
      webdavUser: 'fixture-user',
      webdavPass: 'fixture-webdav-password',
      webdavPath: '/backups',
      apiServer: { apiKey: 'fixture-local-api-key' },
      headers: { Authorization: 'Bearer fixture-auth-header', Accept: 'application/json' },
      theme: 'dark'
    },
    messages: chatBodies.map((content, index) => ({ id: `message-${index}`, role: 'user', content }))
  }
}

function encodeState(state: ReturnType<typeof createState>): string {
  return JSON.stringify({
    llm: JSON.stringify(state.llm),
    settings: JSON.stringify(state.settings),
    messages: JSON.stringify(state.messages),
    _persist: JSON.stringify({ version: 189, rehydrated: true })
  })
}

function decodeState(value: string): ReturnType<typeof createState> {
  const outer = JSON.parse(value) as Record<string, string>
  return { llm: JSON.parse(outer.llm), settings: JSON.parse(outer.settings), messages: JSON.parse(outer.messages) }
}

function redactedState(state: ReturnType<typeof createState>) {
  return {
    ...state,
    llm: {
      ...state.llm,
      providers: state.llm.providers.map((provider) => ({ ...provider, apiKey: '', extra_headers: {} }))
    },
    settings: {
      ...state.settings,
      webdavPass: '',
      apiServer: { apiKey: '' },
      headers: { Authorization: '', Accept: 'application/json' }
    }
  }
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value))
    })
  }
}

let memoryStorage: Storage
let credentials: typeof CredentialsModule

beforeEach(async () => {
  vi.resetModules()
  native.android = true
  native.secureJson = '{}'
  native.writeCount = 0
  native.failAtWrite = 0
  native.command.mockReset()
  native.command.mockImplementation(async (command, args) => {
    switch (command) {
      case 'readCredentials':
        return { value: native.secureJson }
      case 'writeCredentials':
        native.writeCount += 1
        if (native.writeCount === native.failAtWrite) throw new Error('Fixture Keystore write failed')
        if (typeof args?.value !== 'string') throw new Error('Fixture expected a serialized credential store')
        JSON.parse(args.value)
        native.secureJson = args.value
        return undefined
      case 'clearCredentials':
        native.secureJson = '{}'
        return undefined
      default:
        throw new Error(`Unexpected native command: ${command}`)
    }
  })
  memoryStorage = createMemoryStorage()
  vi.stubGlobal('localStorage', memoryStorage)
  credentials = await import('./credentials')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stripCredentials', () => {
  it('removes API keys, WebDAV passwords, Authorization and all custom headers by default', () => {
    const state = createState()
    expect(credentials.stripCredentials(state)).toEqual(redactedState(state))
  })

  it('redacts both serialized levels of Redux persist while preserving other slices', () => {
    const state = createState()
    const result = credentials.stripCredentials(encodeState(state))
    expect(decodeState(result)).toEqual(redactedState(state))
    expect(JSON.parse(result)._persist).toBe(JSON.parse(encodeState(state))._persist)
  })

  it('redacts a localStorage backup containing the serialized Redux record', () => {
    const state = createState()
    const backup = { [PERSIST_KEY]: encodeState(state), language: 'zh-CN', editorDraft: chatBodies[0] }
    const result = credentials.stripCredentials(backup)
    expect(decodeState(result[PERSIST_KEY])).toEqual(redactedState(state))
    expect(result.language).toBe('zh-CN')
    expect(result.editorDraft).toBe(chatBodies[0])
  })

  it.each(chatBodies)('preserves the exact bytes of JSON-looking chat text: %s', (content) => {
    const value = { messages: [{ role: 'user', content }], providers: [{ apiKey: 'fixture-real-key' }] }
    expect(credentials.stripCredentials(value)).toEqual({
      messages: [{ role: 'user', content }],
      providers: [{ apiKey: '' }]
    })
  })

  it('recognizes case variants and preserves noncredential headers', () => {
    expect(
      credentials.stripCredentials({
        API_KEY: 'fixture-key',
        apiKeys: ['fixture-key-a', 'fixture-key-b'],
        WebDAVPass: 'fixture-password',
        headers: { authorization: 'fixture-authorization', 'x-api-key': 'fixture-header-key', Accept: 'text/plain' },
        extra_headers: { 'X-Arbitrary-Header': 'fixture-custom-value' }
      })
    ).toEqual({
      API_KEY: '',
      apiKeys: [],
      WebDAVPass: '',
      headers: { authorization: '', 'x-api-key': '', Accept: 'text/plain' },
      extra_headers: {}
    })
  })

  it('does not mutate the original state while producing a backup', () => {
    const state = createState()
    const original = structuredClone(state)
    credentials.stripCredentials(state)
    expect(state).toEqual(original)
  })
})

describe('hydrateCredentials', () => {
  it('restores string, list and custom-header credentials from the secure store', async () => {
    native.secureJson = JSON.stringify({
      [`${REF_PREFIX}key`]: 'fixture-restored-key',
      [`${REF_PREFIX}keys`]: ['fixture-key-a', 'fixture-key-b'],
      [`${REF_PREFIX}headers`]: { 'X-Arbitrary-Auth': 'fixture-restored-header' }
    })
    await credentials.initializeMobileCredentials()
    expect(
      credentials.hydrateCredentials({
        apiKey: `${REF_PREFIX}key`,
        apiKeys: `${REF_PREFIX}keys`,
        extra_headers: `${REF_PREFIX}headers`,
        content: chatBodies[0]
      })
    ).toEqual({
      apiKey: 'fixture-restored-key',
      apiKeys: ['fixture-key-a', 'fixture-key-b'],
      extra_headers: { 'X-Arbitrary-Auth': 'fixture-restored-header' },
      content: chatBodies[0]
    })
  })

  it('rejects a missing credential reference in a plain object', () => {
    expect(() => credentials.hydrateCredentials({ apiKey: `${REF_PREFIX}missing` })).toThrow(/credential.*unavailable/i)
  })

  it('does not swallow a missing reference inside double-serialized Redux state', () => {
    const state = createState()
    state.llm.providers[0].apiKey = `${REF_PREFIX}missing`
    expect(() => credentials.hydrateCredentials(encodeState(state))).toThrow(/credential.*unavailable/i)
  })
})

describe('mobilePersistStorage', () => {
  it('returns null for an absent record without inventing default persisted state', async () => {
    expect(await credentials.mobilePersistStorage.getItem(PERSIST_KEY)).toBeNull()
    expect(memoryStorage.length).toBe(0)
    expect(native.command.mock.calls.map(([command]) => command)).toEqual(['readCredentials'])
  })

  it('migrates existing plaintext Redux data into private storage before exposing it', async () => {
    const state = createState()
    memoryStorage.setItem(PERSIST_KEY, encodeState(state))
    await credentials.initializeMobileCredentials()
    const persisted = memoryStorage.getItem(PERSIST_KEY)!
    const secured = JSON.parse(native.secureJson) as Record<string, unknown>
    expect(persisted).not.toContain('fixture-provider-a-key')
    expect(persisted).not.toContain('fixture-webdav-password')
    expect(persisted).not.toContain('fixture-auth-header')
    expect(persisted).not.toContain('fixture-provider-a-header')
    expect(Object.values(secured)).toContain('fixture-provider-a-key')
    expect(Object.values(secured)).toContain('fixture-webdav-password')
    expect(Object.values(secured)).toContainEqual(state.llm.providers[0].extra_headers)
    expect(decodeState((await credentials.mobilePersistStorage.getItem(PERSIST_KEY))!)).toEqual(state)
    expect(native.command.mock.calls.filter(([command]) => command === 'readCredentials')).toHaveLength(1)
  })

  it('restores all credentials after a fresh module start and keeps chat text unchanged', async () => {
    const state = createState()
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(state))
    const persisted = memoryStorage.getItem(PERSIST_KEY)!
    const securedState = decodeState(persisted)
    expect(securedState.llm.providers[0].apiKey).toMatch(/^lich13-secret:/)
    expect(securedState.settings.webdavPass).toMatch(/^lich13-secret:/)
    expect(securedState.messages).toEqual(state.messages)
    const privateValues = JSON.parse(native.secureJson) as Record<string, unknown>
    for (const provider of state.llm.providers) {
      expect(persisted).not.toContain(provider.apiKey)
      expect(Object.values(privateValues)).toContain(provider.apiKey)
      expect(Object.values(privateValues)).toContainEqual(provider.extra_headers)
    }

    vi.resetModules()
    const restarted = await import('./credentials')
    expect(decodeState((await restarted.mobilePersistStorage.getItem(PERSIST_KEY))!)).toEqual(state)
    expect(native.command.mock.calls.filter(([command]) => command === 'readCredentials')).toHaveLength(2)
  })

  it.each([
    { phase: 'saving private values', writeOffset: 1 },
    { phase: 'pruning old private values', writeOffset: 2 }
  ])('preserves the previous local record when Keystore fails while $phase', async ({ writeOffset }) => {
    const previous = createState()
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(previous))
    const previousLocal = memoryStorage.getItem(PERSIST_KEY)
    const next = createState()
    next.llm.providers[0].apiKey = 'fixture-replacement-key'
    next.settings.theme = 'light'
    native.failAtWrite = native.writeCount + writeOffset

    await expect(credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(next))).rejects.toThrow(
      'Fixture Keystore write failed'
    )
    expect(memoryStorage.getItem(PERSIST_KEY)).toBe(previousLocal)
    expect(decodeState((await credentials.mobilePersistStorage.getItem(PERSIST_KEY))!)).toEqual(previous)

    native.failAtWrite = 0
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(next))
    expect(decodeState((await credentials.mobilePersistStorage.getItem(PERSIST_KEY))!)).toEqual(next)
  })

  it('rejects missing references during initialization without replacing existing local data', async () => {
    const state = createState()
    state.llm.providers[0].apiKey = `${REF_PREFIX}missing`
    const previousLocal = encodeState(state)
    memoryStorage.setItem(PERSIST_KEY, previousLocal)

    await expect(credentials.initializeMobileCredentials()).rejects.toThrow(/credential.*unavailable/i)
    await expect(credentials.mobilePersistStorage.getItem(PERSIST_KEY)).rejects.toThrow(/credential.*unavailable/i)
    expect(memoryStorage.getItem(PERSIST_KEY)).toBe(previousLocal)
    expect(native.command.mock.calls.every(([command]) => command === 'readCredentials')).toBe(true)
    expect(native.secureJson).toBe('{}')
  })

  it('rejects a newly introduced missing reference without falling back to plaintext', async () => {
    const state = createState()
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(state))
    const previousLocal = memoryStorage.getItem(PERSIST_KEY)
    const previousSecure = native.secureJson
    state.llm.providers[0].apiKey = `${REF_PREFIX}missing`

    await expect(credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(state))).rejects.toThrow(
      /credential.*unavailable/i
    )
    expect(memoryStorage.getItem(PERSIST_KEY)).toBe(previousLocal)
    expect(native.secureJson).toBe(previousSecure)
  })

  it('propagates a Keystore read failure without returning null or clearing local data', async () => {
    const previousLocal = encodeState(createState())
    memoryStorage.setItem(PERSIST_KEY, previousLocal)
    native.command.mockRejectedValueOnce(new Error('Fixture Keystore read failed'))
    await expect(credentials.mobilePersistStorage.getItem(PERSIST_KEY)).rejects.toThrow('Fixture Keystore read failed')
    expect(memoryStorage.getItem(PERSIST_KEY)).toBe(previousLocal)
    expect(native.command).toHaveBeenCalledTimes(1)
  })

  it.each(['null', '[]', 'not-json'])(
    'rejects an invalid private store instead of hydrating an empty state: %s',
    async (secureJson) => {
      native.secureJson = secureJson
      const previousLocal = encodeState(createState())
      memoryStorage.setItem(PERSIST_KEY, previousLocal)
      await expect(credentials.mobilePersistStorage.getItem(PERSIST_KEY)).rejects.toThrow()
      expect(memoryStorage.getItem(PERSIST_KEY)).toBe(previousLocal)
      expect(native.command).toHaveBeenCalledTimes(1)
    }
  )

  it('removes credentials for a deleted provider and retains the remaining provider and WebDAV credentials', async () => {
    const state = createState()
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(state))
    const removedProvider = state.llm.providers[0]
    const oldPrivate = JSON.parse(native.secureJson) as Record<string, unknown>
    const removedRefs = Object.entries(oldPrivate)
      .filter(
        ([, value]) =>
          value === removedProvider.apiKey || JSON.stringify(value) === JSON.stringify(removedProvider.extra_headers)
      )
      .map(([ref]) => ref)
    expect(removedRefs).toHaveLength(2)
    state.llm.providers = state.llm.providers.filter(({ id }) => id !== 'provider-a')
    state.llm.defaultModel.provider = 'provider-b'
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(state))

    const currentPrivate = JSON.parse(native.secureJson) as Record<string, unknown>
    for (const ref of removedRefs) expect(currentPrivate).not.toHaveProperty(ref)
    expect(Object.values(currentPrivate)).toContain('fixture-provider-b-key')
    expect(Object.values(currentPrivate)).toContain('fixture-webdav-password')
    expect(decodeState((await credentials.mobilePersistStorage.getItem(PERSIST_KEY))!)).toEqual(state)
  })

  it('clears private credentials when removing the persisted record and preserves unrelated local preferences', async () => {
    memoryStorage.setItem('language', 'zh-CN')
    await credentials.mobilePersistStorage.setItem(PERSIST_KEY, encodeState(createState()))
    await credentials.mobilePersistStorage.removeItem(PERSIST_KEY)
    expect(memoryStorage.getItem(PERSIST_KEY)).toBeNull()
    expect(memoryStorage.getItem('language')).toBe('zh-CN')
    expect(JSON.parse(native.secureJson)).toEqual({})
    expect(native.command.mock.calls.filter(([command]) => command === 'clearCredentials')).toHaveLength(1)
  })
})
