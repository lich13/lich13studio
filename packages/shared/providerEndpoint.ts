function normalizeEndpoint(value: string, appendVersion = true): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('无效的服务商地址')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('无效的服务商地址')
  }
  let path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (appendVersion) path = path.replace(/\/(responses|messages)$/, '').replace(/\/+$/, '')
  path = path.replace(/(?:\/v1){2,}(?=\/|$)/g, '/v1')
  if (appendVersion && !/\/v\d+(?:beta\d*)?$/.test(path)) path += '/v1'
  url.pathname = path || '/'
  return url.toString().replace(/\/$/, '')
}

/** A trailing # explicitly names a complete endpoint and suppresses /v1. */
export function normalizeProviderEndpoint(value: string): string {
  const host = value.trim()
  if (!host) return ''
  return host.endsWith('#') ? `${normalizeEndpoint(host.slice(0, -1), false)}#` : normalizeEndpoint(host)
}

export function providerRequestBase(value: string): string {
  return normalizeProviderEndpoint(value).replace(/#$/, '')
}
