import { inferProviderPlatform, platformProtocol, type ProviderPlatform } from './platforms'

export type ImportProviderType = 'openai-response' | 'anthropic'
export interface ProviderImport {
  name: string
  type: ImportProviderType
  platform: ProviderPlatform
  apiHost: string
  apiKey: string
  model?: string
  models: string[]
}

export function normalizeImportEndpoint(value: string, appendVersion = true): string {
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
  return host.endsWith('#') ? `${normalizeImportEndpoint(host.slice(0, -1), false)}#` : normalizeImportEndpoint(host)
}

export function providerRequestBase(value: string): string {
  return normalizeProviderEndpoint(value).replace(/#$/, '')
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
  const platform =
    app === 'claude' ? 'anthropic' : app === 'codex' ? 'openai' : app === 'grokbuild' ? 'grok' : undefined
  if (!platform) throw new Error('仅支持 OpenAI、grok 和 Anthropic 服务商')
  const apiKey = url.searchParams.get('apiKey')?.trim()
  const endpoint = url.searchParams.get('endpoint')?.trim()
  if (!apiKey || !endpoint) throw new Error('导入链接缺少 API Key 或地址')
  return {
    type: platformProtocol(platform),
    platform,
    name: url.searchParams.get('name')?.trim() || 'CCS',
    apiHost: normalizeImportEndpoint(endpoint),
    apiKey,
    model: url.searchParams.get('model')?.trim() || undefined,
    models: [
      ...new Set(
        ['model', 'haikuModel', 'sonnetModel', 'opusModel']
          .map((key) => url.searchParams.get(key)?.trim())
          .filter((id): id is string => Boolean(id))
      )
    ]
  }
}

export function matchesProviderImport(
  provider: { type: string; platform?: string; apiHost: string; apiKey: string },
  incoming: ProviderImport
): boolean {
  try {
    return (
      inferProviderPlatform(provider) === incoming.platform &&
      provider.type === incoming.type &&
      normalizeImportEndpoint(provider.apiHost) === incoming.apiHost &&
      provider.apiKey === incoming.apiKey
    )
  } catch {
    return false
  }
}
