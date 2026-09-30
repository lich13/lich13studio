/** Validate the complete payload before changing persistent state or clearing tables. */
export function validatePortableBackup(data: Record<string, any>, tableNames: string[]) {
  if (!data || ![1, 2, 3, 4, 5].includes(data.version) || !data.localStorage || !data.indexedDB) {
    throw new Error('Unsupported backup format')
  }
  const persisted = JSON.parse(data.localStorage['persist:cherry-studio'])
  if (!persisted || Array.isArray(persisted) || typeof persisted !== 'object')
    throw new Error('Invalid application state')
  for (const slice of Object.values(persisted)) {
    if (typeof slice !== 'string') throw new Error('Invalid persisted state')
    JSON.parse(slice)
  }
  if (data.version === 1) {
    if (
      !Array.isArray(data.indexedDB) ||
      data.indexedDB.some((entry) => !entry || typeof entry.key !== 'string' || entry.value == null)
    ) {
      throw new Error('Invalid legacy backup')
    }
    const keys = new Set<string>()
    const topics = new Set<string>()
    for (const { key, value } of data.indexedDB) {
      if (keys.has(key)) throw new Error('Duplicate legacy record')
      keys.add(key)
      if (key.startsWith('topic:')) {
        if (typeof value.id !== 'string' || !value.id || !Array.isArray(value.messages) || topics.has(value.id))
          throw new Error('Invalid legacy topic')
        topics.add(value.id)
      }
    }
    return
  }
  if (Array.isArray(data.indexedDB) || typeof data.indexedDB !== 'object') throw new Error('Invalid backup database')
  for (const [name, rows] of Object.entries(data.indexedDB)) {
    if (!tableNames.includes(name) && name !== 'notes_tree') throw new Error('Unsupported backup table')
    if (!Array.isArray(rows)) throw new Error('Invalid backup table')
    if (name === 'notes_tree') continue
    const ids = new Set<unknown>()
    for (const row of rows) {
      if (!row || !['string', 'number'].includes(typeof row.id) || ids.has(row.id))
        throw new Error('Invalid or duplicate backup record')
      if (typeof row.id === 'string' ? !row.id.trim() : !Number.isFinite(row.id))
        throw new Error('Invalid backup record identifier')
      if (name === 'topics' && !Array.isArray(row.messages)) throw new Error('Invalid topic messages')
      ids.add(row.id)
    }
  }
}
