const DEFAULT_MAX_ENTRIES = 256

export class MemoryKeyv {
  private readonly store = new Map<string, any>()
  private readonly maxEntries: number

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries
  }

  async init(): Promise<void> {}

  get<T = any>(key: string): T | undefined {
    if (!this.store.has(key)) return undefined
    const value = this.store.get(key)
    this.store.delete(key)
    this.store.set(key, value)
    return value
  }

  set<T = any>(key: string, value: T): T {
    if (this.store.has(key)) {
      this.store.delete(key)
    }
    this.store.set(key, value)
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey === undefined) break
      this.store.delete(oldestKey)
    }
    return value
  }

  remove(key: string): boolean {
    return this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}
