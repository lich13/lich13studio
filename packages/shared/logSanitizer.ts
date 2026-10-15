const SENSITIVE_KEY =
  /^(authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|headers?|(?:x[-_]?)?api[-_]?keys?|(?:access[-_]?|refresh[-_]?|id[-_]?)?tokens?|(?:backup[-_]?|webdav[-_]?)?password|secrets?|credentials?|private[-_]?key|prompt|system(?:[-_]?prompt)?|messages|content|body|request[-_]?body(?:values)?|response[-_]?body|request|response|tool[-_]?(input|args)|arguments?)$/i

const REDACTED = '[REDACTED]'

/** Read a complete quoted or structured value, including escaped quotes. */
function fieldValueEnd(text: string, start: number): number {
  const first = text[start]
  let quote = first === '"' || first === "'" ? first : ''
  let nesting = first === '[' || first === '{' ? 1 : 0
  if (!quote && !nesting) {
    const end = text.slice(start).search(/[,;\r\n&?#]/)
    return end < 0 ? text.length : start + end
  }

  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) {
        quote = ''
        if (!nesting) return index + 1
      }
    } else if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') nesting++
    else if ((char === ']' || char === '}') && --nesting === 0) return index + 1
  }
  // An incomplete log value must not expose the remaining secret.
  return text.length
}

function redactFields(text: string): string {
  const fields = /(["']?)([a-z][\w-]*)\1\s*[:=]\s*/gi
  let result = ''
  let cursor = 0
  for (let match = fields.exec(text); match; match = fields.exec(text)) {
    if (!SENSITIVE_KEY.test(match[2])) continue
    const start = fields.lastIndex
    const end = fieldValueEnd(text, start)
    const first = text[start]
    const structured = first === '"' || first === "'" || first === '[' || first === '{'
    result += text.slice(cursor, start) + (structured ? JSON.stringify(REDACTED) : REDACTED)
    cursor = end
    fields.lastIndex = end
  }
  return result + text.slice(cursor)
}

/** Remove credentials and user content before values enter local logs. */
export function sanitizeLogText(value: string): string {
  return redactFields(value)
    .replace(/(\bhttps?:\/\/)[^/\s?#]*@/gi, `$1${REDACTED}@`)
    .replace(/(\b(?:Bearer|Basic)\s+)[^\s,;"']+/gi, `$1${REDACTED}`)
    .replace(/([?&]key=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/\b(?:sk|xai|ghp|github_pat|AIza)[A-Za-z0-9_-]{12,}/g, REDACTED)
}

export function sanitizeLogError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const safe = new Error(sanitizeLogText(source.message).slice(0, 256))
  safe.name = sanitizeLogText(source.name || 'Error')
  return safe
}

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') return sanitizeLogText(value)
  if (value instanceof Error) {
    return { name: sanitizeLogText(value.name), message: sanitizeLogText(value.message) }
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
