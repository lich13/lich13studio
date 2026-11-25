const LEGACY_FAILED_FAVICON_PREFIX = 'failed_favicon_'

function clearLegacyFailedFaviconEntries(): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  const staleKeys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(LEGACY_FAILED_FAVICON_PREFIX)) {
      staleKeys.push(key)
    }
  }
  for (const key of staleKeys) {
    localStorage.removeItem(key)
  }
}

/** Delete only retired caches; never open or create a database. */
export function clearObsoleteCache(): Promise<void> {
  clearLegacyFailedFaviconEntries()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lich13studio-modeltrace-cache')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Obsolete cache cleanup failed'))
    request.onblocked = () => reject(new Error('Obsolete cache is still in use'))
  })
}
