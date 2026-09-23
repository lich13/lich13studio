export type ImportProviderType = 'openai-response' | 'anthropic'
export interface ProviderImport {
  name: string
  type: ImportProviderType
  apiHost: string
  apiKey: string
  model?: string
}

export function normalizeImportEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('无效的服务商地址')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('无效的服务商地址')
  }
  url.pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(responses|messages)$/, '')
    .replace(/\/+$/, '')
  if (!url.pathname.endsWith('/v1')) url.pathname += '/v1'
  return url.toString().replace(/\/$/, '')
}

export function parseProviderImport(raw: string): ProviderImport {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('无效的导入链接')
  }
  if (
    url.protocol !== 'ccswitch:' ||
    url.hostname !== 'v1' ||
    url.pathname !== '/import' ||
    url.searchParams.get('resource') !== 'provider'
  ) {
    throw new Error('仅支持 CCS v1 服务商导入链接')
  }
  const app = url.searchParams.get('app')
  const type = app === 'claude' ? 'anthropic' : app === 'codex' || app === 'grokbuild' ? 'openai-response' : undefined
  if (!type) throw new Error('仅支持 Responses 和 Anthropic 服务商')
  const apiKey = url.searchParams.get('apiKey')?.trim()
  const endpoint = url.searchParams.get('endpoint')?.trim()
  if (!apiKey || !endpoint) throw new Error('导入链接缺少 API Key 或地址')
  return {
    type,
    name: url.searchParams.get('name')?.trim() || 'Sub2API',
    apiHost: normalizeImportEndpoint(endpoint),
    apiKey,
    model: url.searchParams.get('model')?.trim() || undefined
  }
}

export function matchesProviderImport(
  provider: { type: string; apiHost: string; apiKey: string },
  incoming: ProviderImport
): boolean {
  try {
    return (
      provider.type === incoming.type &&
      normalizeImportEndpoint(provider.apiHost) === incoming.apiHost &&
      provider.apiKey === incoming.apiKey
    )
  } catch {
    return false
  }
}
