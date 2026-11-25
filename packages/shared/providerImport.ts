import { inferProviderPlatform, platformProtocol, type ProviderPlatform } from './platforms'
import { normalizeImportEndpoint, normalizeProviderEndpoint, providerRequestBase } from './providerEndpoint'

export { normalizeImportEndpoint, normalizeProviderEndpoint, providerRequestBase }

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

/** Caps keep hostile deep links from exhausting memory before user confirmation. */
export const PROVIDER_IMPORT_MAX_LINK_LENGTH = 8192
export const PROVIDER_IMPORT_MAX_PARAM_LENGTH = 2048
export const PROVIDER_IMPORT_MAX_CONFIG_LENGTH = 4096
export const PROVIDER_IMPORT_MAX_QUEUE = 8
/** Native queue marker for links dropped by size or queue depth; never carries credentials. */
export const PROVIDER_IMPORT_REJECTED_MARKER = 'ccswitch://v1/import?lich13studioRejected=limit'

export class ProviderImportLimitError extends Error {
  constructor() {
    super('导入链接超出大小或数量限制')
    this.name = 'ProviderImportLimitError'
  }
}

type ResolvedFormat = 'anthropic' | 'openai_responses' | 'unsupported'

interface ExtractedConfig {
  name?: string
  endpoint?: string
  apiKey?: string
  model?: string
  models: string[]
  protocol?: ResolvedFormat
}

const DYNAMIC_VALUE_PATTERN = /\$\{[^}]*\}|\{env:[^}]*\}|\{file:[^}]*\}|^\s*!\S/i

function assertStaticValue(value: string | undefined): void {
  if (value && DYNAMIC_VALUE_PATTERN.test(value)) {
    throw new Error('不支持动态环境变量、文件引用或命令凭据')
  }
}

function decodeBase64Utf8(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/ /g, '+')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[\r\n]+/g, '')
  if (!cleaned || cleaned.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new Error('无效的 Base64 配置内容')
  }
  const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function mapProtocolHint(hint: string | undefined): ResolvedFormat | undefined {
  if (!hint) return undefined
  const normalized = hint.trim().toLowerCase()
  if (!normalized) return undefined
  if (
    normalized === 'anthropic' ||
    normalized === 'anthropic-messages' ||
    normalized === 'anthropic_messages' ||
    normalized === '@ai-sdk/anthropic'
  ) {
    return 'anthropic'
  }
  if (
    normalized === 'openai_responses' ||
    normalized === 'openai-responses' ||
    normalized === 'codex_responses' ||
    normalized === 'codex-responses' ||
    normalized === 'responses' ||
    normalized === '@ai-sdk/openai'
  ) {
    return 'openai_responses'
  }
  return 'unsupported'
}

function unescapeTomlBasicString(body: string): string {
  return body.replace(/\\([nrt"\\])/g, (_match, code: string) => {
    switch (code) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case '"':
        return '"'
      default:
        return '\\'
    }
  })
}

function unquoteTomlValue(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return unescapeTomlBasicString(trimmed.slice(1, -1))
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  const commentIdx = trimmed.indexOf('#')
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim()
}

function stripTomlLineComment(line: string): string {
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inDouble) {
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i)
    }
  }
  return line
}

function findUnquotedCharIndex(text: string, target: string): number {
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inDouble) {
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === target && !inSingle && !inDouble) {
      return i
    }
  }
  return -1
}

function parseTomlKeySegment(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('无效的 TOML 键名或表头语法')
  }
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 2) {
      throw new Error('无效的 TOML 键名或表头语法')
    }
    let escaped = false
    for (let i = 1; i < trimmed.length - 1; i += 1) {
      if (escaped) {
        escaped = false
        continue
      }
      if (trimmed[i] === '\\') {
        escaped = true
        continue
      }
      if (trimmed[i] === '"') {
        throw new Error('无效的 TOML 键名或表头语法')
      }
    }
    if (escaped) {
      throw new Error('无效的 TOML 键名或表头语法')
    }
    const unescaped = unescapeTomlBasicString(trimmed.slice(1, -1))
    if (!unescaped) {
      throw new Error('无效的 TOML 键名或表头语法')
    }
    return unescaped
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2 || trimmed.slice(1, -1).includes("'")) {
      throw new Error('无效的 TOML 键名或表头语法')
    }
    const unquoted = trimmed.slice(1, -1)
    if (!unquoted) {
      throw new Error('无效的 TOML 键名或表头语法')
    }
    return unquoted
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error('无效的 TOML 键名或表头语法')
  }
  return trimmed
}

function parseTomlDottedKey(raw: string): string[] {
  const segments: string[] = []
  let start = 0
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && inDouble) {
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === '.' && !inSingle && !inDouble) {
      segments.push(parseTomlKeySegment(raw.slice(start, i)))
      start = i + 1
    }
  }
  if (inSingle || inDouble || escaped) {
    throw new Error('无效的 TOML 键名或表头语法')
  }
  segments.push(parseTomlKeySegment(raw.slice(start)))
  return segments
}

interface TomlSectionRecord {
  segments: string[]
  values: Record<string, string>
}

function parseTomlConfig(text: string): ExtractedConfig {
  const root: Record<string, string> = {}
  const sections = new Map<string, TomlSectionRecord>()
  let currentSegments: string[] = []

  const sectionKey = (segments: readonly string[]) => JSON.stringify(segments)
  const ensureSection = (segments: string[]): Record<string, string> => {
    const key = sectionKey(segments)
    let entry = sections.get(key)
    if (!entry) {
      entry = { segments, values: {} }
      sections.set(key, entry)
    }
    return entry.values
  }
  const hasStrictAncestorInNamespace = (segments: readonly string[], minPrefixLen: number): boolean => {
    for (let len = minPrefixLen; len < segments.length; len += 1) {
      if (sections.has(sectionKey(segments.slice(0, len)))) {
        return true
      }
    }
    return false
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlLineComment(rawLine).trim()
    if (!line) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      const isArrayHeader = line.startsWith('[[') || line.endsWith(']]')
      if (isArrayHeader && !(line.startsWith('[[') && line.endsWith(']]'))) {
        throw new Error('无效的 TOML 键名或表头语法')
      }
      const headerBody = isArrayHeader ? line.slice(2, -2).trim() : line.slice(1, -1).trim()
      currentSegments = parseTomlDottedKey(headerBody)
      ensureSection(currentSegments)
      continue
    }
    const eqIndex = findUnquotedCharIndex(line, '=')
    if (eqIndex <= 0) continue
    const keySegments = parseTomlDottedKey(line.slice(0, eqIndex))
    const key = keySegments[keySegments.length - 1]
    const value = unquoteTomlValue(line.slice(eqIndex + 1))
    if (key === 'env_key' || key === 'envKey' || key === 'configUrl') {
      throw new Error('不支持间接环境变量凭据或远程配置')
    }
    assertStaticValue(value)
    if (keySegments.length === 1) {
      if (currentSegments.length === 0) {
        root[key] = value
      } else {
        ensureSection(currentSegments)[key] = value
      }
    } else {
      const targetSegments = [...currentSegments, ...keySegments.slice(0, -1)]
      ensureSection(targetSegments)[key] = value
    }
  }

  let endpoint = root.base_url || root.api_url || root.endpoint
  let apiKey = root.api_key || root.experimental_bearer_token || root.apiKey
  let name = root.name
  let protocol = mapProtocolHint(root.wire_api || root.api_format || root.apiFormat)
  const models: string[] = []
  if (root.model) models.push(root.model)

  const providerSectionEntries = [...sections.values()].filter(
    ({ segments }) =>
      segments.length >= 2 && segments[0] === 'model_providers' && !hasStrictAncestorInNamespace(segments, 2)
  )
  if (providerSectionEntries.length > 0) {
    let selectedProviderSec: Record<string, string> | undefined
    if (root.model_provider) {
      selectedProviderSec =
        sections.get(sectionKey(['model_providers', root.model_provider]))?.values ??
        providerSectionEntries.find(({ segments }) => segments.slice(1).join('.') === root.model_provider)?.values
      if (!selectedProviderSec) {
        throw new Error('未找到指定的 model_provider 配置')
      }
    } else if (providerSectionEntries.length === 1) {
      selectedProviderSec = providerSectionEntries[0].values
    } else {
      throw new Error('多服务商 TOML 配置缺少 model_provider 指定项')
    }
    endpoint ||= selectedProviderSec.base_url || selectedProviderSec.api_url || selectedProviderSec.endpoint
    apiKey ||=
      selectedProviderSec.api_key || selectedProviderSec.experimental_bearer_token || selectedProviderSec.apiKey
    name ||= selectedProviderSec.name
    protocol ||= mapProtocolHint(
      selectedProviderSec.wire_api || selectedProviderSec.api_format || selectedProviderSec.apiFormat
    )
    if (selectedProviderSec.model) models.push(selectedProviderSec.model)
  }

  const defaultModelName = (
    sections.get(sectionKey(['models']))?.values.default ||
    root.default_model ||
    root.model ||
    ''
  ).trim()
  const modelSectionEntries = [...sections.values()].filter(
    ({ segments }) =>
      (segments.length === 1 && segments[0] === 'model') ||
      (segments.length >= 2 &&
        (segments[0] === 'model' || segments[0] === 'models') &&
        !hasStrictAncestorInNamespace(segments, 2))
  )
  if (modelSectionEntries.length > 0) {
    const extractTableModelId = (segments: readonly string[], sec: Record<string, string>): string => {
      if (segments.length === 1 && segments[0] === 'model') {
        return (sec.model || sec.id || sec.name || '').trim()
      }
      const suffix = segments.slice(1).join('.').trim()
      return (sec.model || sec.id || suffix).trim()
    }

    let selectedEntry: TomlSectionRecord | undefined
    if (defaultModelName) {
      selectedEntry = modelSectionEntries.find(({ segments, values: sec }) => {
        const suffix = segments.length >= 2 ? segments.slice(1).join('.').trim() : ''
        return suffix === defaultModelName || sec.model === defaultModelName || sec.id === defaultModelName
      })
      if (!selectedEntry) {
        throw new Error('未找到默认模型配置表')
      }
    } else if (modelSectionEntries.length === 1) {
      selectedEntry = modelSectionEntries[0]
    } else {
      throw new Error('多模型 TOML 配置缺少默认模型指定项')
    }

    const { segments, values: sec } = selectedEntry
    endpoint ||= sec.base_url || sec.api_url || sec.endpoint
    apiKey ||= sec.api_key || sec.apiKey
    name ||= sec.provider_name || sec.name
    protocol ||= mapProtocolHint(sec.wire_api || sec.api_format || sec.apiFormat)
    const modelId = extractTableModelId(segments, sec)
    if (modelId && modelId !== 'default') {
      models.push(modelId)
    }
  }

  const dedupedModels = [...new Set(models.map((m) => m.trim()).filter(Boolean))]
  return {
    name: name?.trim() || undefined,
    endpoint: endpoint?.trim() || undefined,
    apiKey: apiKey?.trim() || undefined,
    model: dedupedModels[0],
    models: dedupedModels,
    protocol
  }
}

function validateJsonObjectTree(node: unknown): void {
  if (typeof node === 'string') {
    assertStaticValue(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) validateJsonObjectTree(item)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (
        (key === 'env_key' || key === 'envKey' || key === 'configUrl') &&
        val !== undefined &&
        val !== null &&
        val !== ''
      ) {
        throw new Error('不支持间接环境变量凭据或远程配置')
      }
      validateJsonObjectTree(val)
    }
  }
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseJsonConfig(text: string): ExtractedConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无效的 JSON 配置内容')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('无效的 JSON 配置内容')
  }
  validateJsonObjectTree(parsed)
  const obj = parsed as Record<string, unknown>
  const env =
    obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env) ? (obj.env as Record<string, unknown>) : undefined
  const auth =
    obj.auth && typeof obj.auth === 'object' && !Array.isArray(obj.auth)
      ? (obj.auth as Record<string, unknown>)
      : undefined
  const options =
    obj.options && typeof obj.options === 'object' && !Array.isArray(obj.options)
      ? (obj.options as Record<string, unknown>)
      : undefined

  const nestedToml = typeof obj.config === 'string' ? parseTomlConfig(obj.config) : undefined

  const endpoint =
    asTrimmedString(env?.ANTHROPIC_BASE_URL) ??
    asTrimmedString(obj.endpoint) ??
    asTrimmedString(obj.baseUrl) ??
    asTrimmedString(obj.base_url) ??
    asTrimmedString(obj.baseURL) ??
    asTrimmedString(options?.baseURL) ??
    asTrimmedString(options?.baseUrl) ??
    nestedToml?.endpoint

  const apiKey =
    asTrimmedString(env?.ANTHROPIC_AUTH_TOKEN) ??
    asTrimmedString(env?.ANTHROPIC_API_KEY) ??
    asTrimmedString(auth?.OPENAI_API_KEY) ??
    asTrimmedString(auth?.ANTHROPIC_API_KEY) ??
    asTrimmedString(obj.apiKey) ??
    asTrimmedString(obj.api_key) ??
    asTrimmedString(obj.authToken) ??
    asTrimmedString(options?.apiKey) ??
    nestedToml?.apiKey

  const name = asTrimmedString(obj.name) ?? nestedToml?.name

  let protocol: ResolvedFormat | undefined =
    mapProtocolHint(asTrimmedString(obj.apiFormat)) ??
    mapProtocolHint(asTrimmedString(obj.api)) ??
    mapProtocolHint(asTrimmedString(obj.api_mode)) ??
    mapProtocolHint(asTrimmedString(obj.wire_api)) ??
    mapProtocolHint(asTrimmedString(obj.npm)) ??
    nestedToml?.protocol

  if (!protocol && env && (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY)) {
    protocol = 'anthropic'
  }

  const rawModels: string[] = []
  for (const candidate of [
    env?.ANTHROPIC_MODEL,
    env?.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    env?.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env?.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env?.ANTHROPIC_SMALL_FAST_MODEL,
    obj.model,
    obj.defaultModel
  ]) {
    const str = asTrimmedString(candidate)
    if (str) rawModels.push(str)
  }
  if (Array.isArray(obj.models)) {
    for (const entry of obj.models) {
      const str =
        typeof entry === 'string'
          ? asTrimmedString(entry)
          : entry && typeof entry === 'object'
            ? asTrimmedString((entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).name)
            : undefined
      if (str) rawModels.push(str)
    }
  } else if (obj.models && typeof obj.models === 'object') {
    for (const modelKey of Object.keys(obj.models as Record<string, unknown>)) {
      if (modelKey.trim()) rawModels.push(modelKey.trim())
    }
  }
  if (nestedToml?.models.length) {
    rawModels.push(...nestedToml.models)
  }

  const models = [...new Set(rawModels)]
  return {
    name,
    endpoint,
    apiKey,
    model: asTrimmedString(env?.ANTHROPIC_MODEL) ?? asTrimmedString(obj.model) ?? nestedToml?.model ?? models[0],
    models,
    protocol
  }
}

function parseInlineConfig(encoded: string, configFormat?: string | null): ExtractedConfig {
  const decoded = decodeBase64Utf8(encoded)
  const fmt = configFormat?.trim().toLowerCase()
  if (fmt === 'json') {
    return parseJsonConfig(decoded)
  }
  if (fmt === 'toml') {
    return parseTomlConfig(decoded)
  }
  return decoded.trimStart().startsWith('{') ? parseJsonConfig(decoded) : parseTomlConfig(decoded)
}

function extractFirstImportEndpoint(rawEndpoint: string): string {
  const firstCandidate = rawEndpoint
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)
  if (!firstCandidate) {
    throw new Error('无效的服务商地址')
  }
  assertStaticValue(firstCandidate)
  return normalizeImportEndpoint(firstCandidate)
}

export function parseProviderImport(raw: string): ProviderImport {
  if (raw === PROVIDER_IMPORT_REJECTED_MARKER || raw.length > PROVIDER_IMPORT_MAX_LINK_LENGTH) {
    throw new ProviderImportLimitError()
  }
  let url: URL
  try {
    if (!/^ccswitch:\/\//i.test(raw)) throw new Error('Invalid scheme')
    // Chromium 91 treats custom schemes as opaque paths. Parse the validated
    // scheme with an HTTP authority so Android 12 and modern engines agree.
    url = new URL(`https:${raw.slice(raw.indexOf(':') + 1)}`)
  } catch {
    throw new Error('无效的导入链接')
  }
  if (
    url.hostname !== 'v1' ||
    url.pathname !== '/import' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.searchParams.get('resource') !== 'provider'
  ) {
    throw new Error('仅支持 CCS v1 服务商导入链接')
  }
  if (url.searchParams.has('configUrl') || url.searchParams.has('env_key') || url.searchParams.has('envKey')) {
    throw new Error('不支持远程配置链接或间接环境变量凭据')
  }
  for (const [key, value] of url.searchParams) {
    const maxValLen =
      key === 'config' || key === 'usageScript' ? PROVIDER_IMPORT_MAX_CONFIG_LENGTH : PROVIDER_IMPORT_MAX_PARAM_LENGTH
    if (key.length > PROVIDER_IMPORT_MAX_PARAM_LENGTH || value.length > maxValLen) {
      throw new ProviderImportLimitError()
    }
    if (key !== 'config' && key !== 'usageScript') {
      assertStaticValue(value)
    }
  }

  // usageScript is intentionally ignored and never evaluated.
  const encodedConfig = url.searchParams.get('config')
  const configData = encodedConfig?.trim()
    ? parseInlineConfig(encodedConfig, url.searchParams.get('configFormat'))
    : undefined

  const rawApiFormat = url.searchParams.get('apiFormat')?.trim()
  const app = url.searchParams.get('app')?.trim().toLowerCase()

  let resolvedFormat: ResolvedFormat | undefined
  if (rawApiFormat) {
    const mapped = mapProtocolHint(rawApiFormat)
    if (mapped === 'anthropic' || mapped === 'openai_responses') {
      resolvedFormat = mapped
    } else {
      throw new Error('仅支持 Anthropic 或 OpenAI Responses 协议')
    }
  } else if (configData?.protocol) {
    resolvedFormat = configData.protocol
  } else if (app === 'claude' || app === 'claude-desktop') {
    resolvedFormat = 'anthropic'
  } else if (app === 'codex' || app === 'grokbuild') {
    resolvedFormat = 'openai_responses'
  }

  if (resolvedFormat !== 'anthropic' && resolvedFormat !== 'openai_responses') {
    throw new Error('仅支持 OpenAI Responses、grok 和 Anthropic 服务商')
  }

  const rawApiKey = url.searchParams.get('apiKey')?.trim() || configData?.apiKey
  const rawEndpoint = url.searchParams.get('endpoint')?.trim() || configData?.endpoint
  if (!rawApiKey || !rawEndpoint) {
    throw new Error('导入链接缺少 API Key 或地址')
  }
  assertStaticValue(rawApiKey)
  const apiHost = extractFirstImportEndpoint(rawEndpoint)

  const queryModels = ['model', 'haikuModel', 'sonnetModel', 'opusModel']
    .map((key) => url.searchParams.get(key)?.trim())
    .filter((id): id is string => Boolean(id))
  const models = [...new Set([...queryModels, ...(configData?.models ?? [])])]
  const primaryModel = url.searchParams.get('model')?.trim() || configData?.model || models[0] || undefined

  const platform: ProviderPlatform =
    resolvedFormat === 'anthropic'
      ? 'anthropic'
      : app === 'grokbuild'
        ? 'grok'
        : inferProviderPlatform({
            type: 'openai-response',
            apiHost,
            models: models.map((id) => ({ id }))
          })

  return {
    type: platformProtocol(platform),
    platform,
    name: url.searchParams.get('name')?.trim() || configData?.name || 'CCS',
    apiHost,
    apiKey: rawApiKey,
    model: primaryModel,
    models
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
