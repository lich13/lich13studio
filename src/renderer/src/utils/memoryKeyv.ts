export class MemoryKeyv {
  private readonly store = new Map<string, any>()

  async init(): Promise<void> {}

  get<T = any>(key: string): T | undefined {
    return this.store.get(key)
  }

  set<T = any>(key: string, value: T): T {
    this.store.set(key, value)
    return value
  }

  remove(key: string): boolean {
    return this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}
