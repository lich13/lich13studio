const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|headers?|api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|secret|prompt|messages|content|body|request[-_]?body(?:values)?|response[-_]?body|request|response|tool[-_]?(input|args)|arguments?)$/i

const SENSITIVE_TEXT = [
  /(\bBearer\s+)[^\s,;]+/gi,
  /([?&](?:api[-_]?key|key|token|access[-_]?token|refresh[-_]?token|password|secret)=)[^&#\s]+/gi,
  /(\b(?:api[-_]?key|token|password|secret|cookie)\s*[:=]\s*)[^\s,;&?#]+/gi,
  /\b(?:sk|xai|ghp|github_pat|AIza)[A-Za-z0-9_-]{12,}/g
]

/** Remove credentials and user content before values enter local logs. */
export function sanitizeLogText(value: string): string {
  return SENSITIVE_TEXT.reduce(
    (result, pattern) =>
      result.replace(pattern, (...args) => {
        const capture = typeof args[1] === 'string' ? args[1] : ''
        return `${capture}[REDACTED]`
      }),
    value
  )
}

export function sanitizeLogError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const safe = new Error(sanitizeLogText(source.message).slice(0, 256))
  safe.name = source.name || 'Error'
  return safe
}

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') return sanitizeLogText(value)
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeLogText(value.message) }
  }
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth >= 3) return Array.isArray(value) ? { type: 'array', length: value.length } : { type: 'object' }

  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeLogValue(item, depth + 1, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = sanitizeLogValue(nested, depth + 1, seen)
    }
  }
  return result
}
