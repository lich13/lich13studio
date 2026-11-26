function isPlainJsonObject(val: object): boolean {
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype || Array.isArray(val)
}

export function safeSerialize(
  value: unknown,
  options: {
    onError?: 'error' | 'omit' | 'serialize'
    pretty?: boolean
  } = {}
): string | null {
  const { onError = 'serialize', pretty = true } = options
  const space = pretty ? 2 : undefined

  if (value === undefined) {
    if (onError === 'error') throw new TypeError('Value is not serializable and cannot be safely serialized.')
    if (onError === 'omit') return null
    return JSON.stringify('[undefined]', null, space)
  }

  const ancestors: object[] = []

  try {
    return JSON.stringify(
      value,
      function (_key, val: unknown) {
        if (typeof val === 'object' && val !== null) {
          while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop()
          }
          if (ancestors.includes(val)) {
            if (onError === 'error') throw new TypeError('Circular reference cannot be serialized.')
            if (onError === 'omit') throw new TypeError('Omit circular reference')
            return '[Circular]'
          }
          ancestors.push(val)

          if (!isPlainJsonObject(val)) {
            if (onError === 'error') throw new TypeError('Value is not serializable and cannot be safely serialized.')
            if (onError === 'omit') throw new TypeError('Omit non-plain object')
            if (val instanceof Date) return val.toISOString()
            if (val instanceof RegExp) return `{RegExp: "${val.toString()}"}`
            if (val instanceof Map) return Object.fromEntries(val.entries())
            if (val instanceof Set) return Array.from(val)
          }
          return val
        }

        if (typeof val === 'function' || typeof val === 'symbol' || val === undefined) {
          if (onError === 'error') throw new TypeError('Value is not serializable and cannot be safely serialized.')
          if (onError === 'omit') throw new TypeError('Omit non-serializable primitive')
          if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`
          if (typeof val === 'symbol') return `Symbol(${String(val.description)})`
          return '[undefined]'
        }

        return val
      },
      space
    )
  } catch (err) {
    if (onError === 'error') {
      throw err instanceof TypeError
        ? err
        : new Error(`Failed to stringify serializable value: ${err instanceof Error ? err.message : err}`)
    }
    return null
  }
}
