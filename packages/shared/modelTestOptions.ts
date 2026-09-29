export type ModelTestConcurrency = 1 | 2 | 3

export function normalizeModelTestConcurrency(value: unknown): ModelTestConcurrency {
  return value === 2 || value === 3 ? value : 1
}
