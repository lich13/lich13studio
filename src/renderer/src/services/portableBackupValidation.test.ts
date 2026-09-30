import { describe, expect, it } from 'vitest'

import { validatePortableBackup } from './portableBackupValidation'

const tables = ['topics', 'message_blocks', 'files', 'settings']
const applicationState = () =>
  JSON.stringify({
    llm: JSON.stringify({ providers: [], defaultModel: { id: 'gpt-6.1-sol', provider: 'fixture' } }),
    settings: JSON.stringify({ theme: 'dark' }),
    assistants: JSON.stringify({ assistants: [] }),
    _persist: JSON.stringify({ version: 189, rehydrated: true })
  })
const backup = (version = 5): Record<string, any> => ({
  version,
  time: 1_000,
  localStorage: { 'persist:cherry-studio': applicationState(), language: 'zh-CN' },
  indexedDB: {
    topics: [{ id: 'topic-1', messages: [{ id: 'message-1', role: 'user', content: 'fixture' }] }],
    message_blocks: [{ id: 'block-1', content: 'fixture' }],
    files: [],
    settings: [{ id: 'theme', value: 'dark' }]
  }
})
const legacyBackup = (): Record<string, any> => ({
  ...backup(1),
  indexedDB: [
    { key: 'topic:topic-1', value: { id: 'topic-1', messages: [{ id: 'message-1', content: 'fixture' }] } },
    { key: 'image://avatar', value: 'data:image/png;base64,fixture' }
  ]
})

function freezeDeep(value: unknown) {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeDeep(entry)
    Object.freeze(value)
  }
}

function expectInvalid(value: Record<string, any>) {
  const before = structuredClone(value)
  freezeDeep(value)
  expect(() => validatePortableBackup(value, tables)).toThrow()
  expect(value).toEqual(before)
}

describe('validatePortableBackup', () => {
  it.each([2, 3, 4, 5])('accepts supported table-based backup version %i without changing it', (version) => {
    const value = backup(version)
    const before = structuredClone(value)
    freezeDeep(value)
    expect(() => validatePortableBackup(value, tables)).not.toThrow()
    expect(value).toEqual(before)
  })

  it('accepts a v1 backup with legacy topics and an avatar', () => {
    const value = legacyBackup()
    const before = structuredClone(value)
    freezeDeep(value)
    expect(() => validatePortableBackup(value, tables)).not.toThrow()
    expect(value).toEqual(before)
  })

  it('accepts empty tables and a legacy notes_tree which is ignored during import', () => {
    const value = backup()
    value.indexedDB = { topics: [], files: [], settings: [], notes_tree: [{ title: 'legacy note', children: [] }] }
    expect(() => validatePortableBackup(value, tables)).not.toThrow()
  })

  it('permits the same ID in distinct tables and numeric zero as a valid record key', () => {
    const value = backup()
    value.indexedDB.settings = [
      { id: 'topic-1', value: 'independent table' },
      { id: 0, value: 'valid numeric key' }
    ]
    expect(() => validatePortableBackup(value, tables)).not.toThrow()
  })

  it.each([0, 6, '5', undefined])('rejects unsupported version %s', (version) => {
    const value = backup()
    value.version = version
    expectInvalid(value)
  })

  it.each(['missing localStorage', 'missing indexedDB', 'missing persist record'])('rejects %s', (kind) => {
    const value = backup()
    if (kind === 'missing localStorage') delete value.localStorage
    if (kind === 'missing indexedDB') delete value.indexedDB
    if (kind === 'missing persist record') delete value.localStorage['persist:cherry-studio']
    expectInvalid(value)
  })

  it.each(['not-json', 'null', '[]', '"state"', '123'])('rejects malformed application state: %s', (persisted) => {
    const value = backup()
    value.localStorage['persist:cherry-studio'] = persisted
    expectInvalid(value)
  })

  it.each([{ settings: { theme: 'dark' } }, { settings: '{"theme":' }, { llm: 'not-json' }])(
    'rejects broken Redux serialization: %j',
    (persisted) => {
      const value = backup()
      value.localStorage['persist:cherry-studio'] = JSON.stringify(persisted)
      expectInvalid(value)
    }
  )

  it.each([
    { label: 'array', indexedDB: [] },
    { label: 'string', indexedDB: 'database' },
    { label: 'number', indexedDB: 1 }
  ])('rejects a non-table database: $label', ({ indexedDB }) => {
    const value = backup()
    value.indexedDB = indexedDB
    expectInvalid(value)
  })

  it.each([{ unknown_table: [] }, { topics: {} }, { topics: null }, { topics: 'rows' }, { notes_tree: {} }])(
    'rejects unsupported or corrupt tables: %j',
    (indexedDB) => {
      const value = backup()
      value.indexedDB = indexedDB
      expectInvalid(value)
    }
  )

  it.each([null, {}, { id: true }, { id: {} }, { id: '' }])('rejects an invalid record identifier: %j', (row) => {
    const value = backup()
    value.indexedDB.files = [row]
    expectInvalid(value)
  })

  it.each(['duplicate-string', 9])('rejects duplicate IDs within a table: %s', (id) => {
    const value = backup()
    value.indexedDB.files = [
      { id, name: 'one' },
      { id, name: 'two' }
    ]
    expectInvalid(value)
  })

  it.each([undefined, null, {}, 'messages'])('rejects a topic without a message array: %j', (messages) => {
    const value = backup()
    value.indexedDB.topics = [{ id: 'topic-1', messages }]
    expectInvalid(value)
  })

  it.each([
    { label: 'non-array store', indexedDB: {} },
    { label: 'null record', indexedDB: [null] },
    { label: 'non-string key', indexedDB: [{ key: 3, value: {} }] },
    { label: 'missing value', indexedDB: [{ key: 'topic:one' }] }
  ])('rejects corrupt legacy entries: $label', ({ indexedDB }) => {
    const value = legacyBackup()
    value.indexedDB = indexedDB
    expectInvalid(value)
  })

  it.each([{ messages: [] }, { id: 'topic-1' }, { id: 'topic-1', messages: {} }, { id: '', messages: [] }])(
    'rejects a corrupt legacy topic before import: %j',
    (topic) => {
      const value = legacyBackup()
      value.indexedDB = [{ key: 'topic:topic-1', value: topic }]
      expectInvalid(value)
    }
  )

  it('rejects duplicate legacy keys', () => {
    const value = legacyBackup()
    value.indexedDB.push(structuredClone(value.indexedDB[0]))
    expectInvalid(value)
  })

  it('rejects duplicate topic IDs stored under distinct legacy keys', () => {
    const value = legacyBackup()
    value.indexedDB.push({ key: 'topic:another-key', value: { id: 'topic-1', messages: [] } })
    expectInvalid(value)
  })
})
