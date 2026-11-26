export function formatApiKeys(value: string): string {
  return value.replaceAll('，', ',').replaceAll('\n', ',')
}

export function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

export function maskApiKey(key: string): string {
  if (!key) return ''

  if (key.length > 24) {
    return `${key.slice(0, 8)}****${key.slice(-8)}`
  } else if (key.length > 16) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  } else if (key.length > 8) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  } else {
    return key
  }
}

export function splitApiKeyString(keyStr: string): string[] {
  return keyStr
    .split(/(?<!\\),/)
    .map((k) => k.trim())
    .map((k) => k.replace(/\\,/g, ','))
    .filter((k) => k)
}
