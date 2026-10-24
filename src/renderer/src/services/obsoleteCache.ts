/** Delete only the retired feature's cache; never open or create a database. */
export function clearObsoleteCache(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lich13studio-modeltrace-cache')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Obsolete cache cleanup failed'))
    request.onblocked = () => reject(new Error('Obsolete cache is still in use'))
  })
}
