import { platformRequestHeaders } from './cliIdentity'
import {
  catalogModel,
  createPlatformModels,
  inferProviderPlatform,
  PROVIDER_PLATFORMS,
  storedProvider
} from './platforms'
import { normalizeProviderEndpoint } from './providerImport'
import { normalizeReasoningEffort } from './reasoning'

export const PROVIDER_RESET_VERSION = 216
export const PLATFORM_MIGRATION_VERSION = 217

type State = Record<string, any>

/** Runs at both rehydration and backup restore boundaries. Never traverses chat messages. */
export function sanitizeState<T extends State>(state: T, resetProviders = false): T {
  delete state.mcp
  if (resetProviders && state.llm) {
    state.llm.providers = []
    for (const key of ['defaultModel', 'topicNamingModel', 'quickModel', 'translateModel']) delete state.llm[key]
    state.llm.settings = {
      ollama: { keepAliveTime: 0 },
      lmstudio: { keepAliveTime: 0 },
      gpustack: { keepAliveTime: 0 },
      vertexai: { serviceAccount: { privateKey: '', clientEmail: '' }, projectId: '', location: '' },
      awsBedrock: { authType: 'iam', accessKeyId: '', secretAccessKey: '', apiKey: '', region: '' },
      cherryIn: { accessToken: '', refreshToken: '' }
    }
  }
  const providers = state.llm?.providers
  if (Array.isArray(providers)) {
    state.llm.providers = providers.filter((p) => p && ['openai-response', 'anthropic'].includes(p.type))
    for (const key of ['defaultModel', 'topicNamingModel', 'quickModel', 'translateModel']) {
      const model = state.llm[key]
      if (model && !state.llm.providers.some((p) => p.id === model.provider)) delete state.llm[key]
    }
  }
  if (resetProviders) {
    if (state.codeTools) state.codeTools.selectedModels = {}
    if (state.openclaw) state.openclaw.selectedModelUniqId = null
  }
  const assistants = state.assistants
  const entries = [assistants?.defaultAssistant, ...(assistants?.assistants ?? []), ...(assistants?.presets ?? [])]
  for (const assistant of entries) {
    if (!assistant || typeof assistant !== 'object') continue
    delete assistant.mcpMode
    delete assistant.mcpServers
    for (const key of ['model', 'defaultModel']) {
      if (resetProviders || (assistant[key] && !state.llm?.providers?.some((p) => p.id === assistant[key].provider)))
        delete assistant[key]
    }
    assistant.settings ??= {}
    if (
      resetProviders ||
      (assistant.settings.defaultModel &&
        !state.llm?.providers?.some((p) => p.id === assistant.settings.defaultModel.provider))
    )
      delete assistant.settings.defaultModel
    if (assistant.settings.reasoning_effort_cache !== undefined)
      assistant.settings.reasoning_effort_cache = normalizeReasoningEffort(assistant.settings.reasoning_effort_cache)
    assistant.settings.reasoning_effort = normalizeReasoningEffort(assistant.settings.reasoning_effort)
  }
  if (state.websearch?.providers) {
    state.websearch.providers = state.websearch.providers.filter((p) => p.id !== 'exa-mcp')
    if (state.websearch.defaultProvider === 'exa-mcp') state.websearch.defaultProvider = 'local-google'
  }
  for (const order of Object.values(state.inputTools ?? {}) as any[]) {
    if (!order || typeof order !== 'object') continue
    for (const key of ['visible', 'hidden']) {
      if (Array.isArray(order[key])) order[key] = order[key].filter((id) => id !== 'mcp_tools')
    }
  }
  return state
}

/** Redux Persist stores each slice as a JSON string. Keep its version for older migrations. */
export function sanitizePersistedState(raw: string): string {
  const persisted = JSON.parse(raw)
  const decoded: State = {}
  for (const [key, value] of Object.entries(persisted)) {
    decoded[key] = typeof value === 'string' ? JSON.parse(value) : value
  }
  sanitizeState(decoded, (decoded._persist?.version ?? -1) < PROVIDER_RESET_VERSION)
  migratePlatformState(decoded)
  return JSON.stringify(Object.fromEntries(Object.entries(decoded).map(([key, value]) => [key, JSON.stringify(value)])))
}

/** Idempotent across Redux upgrades and backup restore. Chat records are never traversed. */
export function migratePlatformState<T extends State>(state: T): T {
  const llm = state.llm
  if (!llm) return state
  const seeds = createPlatformModels()
  if (!llm.platformModels) {
    llm.platformModels = Object.fromEntries(PROVIDER_PLATFORMS.map((platform) => [platform, []]))
    for (const provider of llm.providers ?? []) {
      const models = llm.platformModels[inferProviderPlatform(provider)]
      for (const model of provider.models ?? [])
        if (model?.id && !models.some((m) => m.id === model.id)) models.push(catalogModel(model))
    }
    for (const platform of PROVIDER_PLATFORMS) {
      for (const model of seeds[platform])
        if (!llm.platformModels[platform].some((m) => m.id === model.id)) llm.platformModels[platform].push(model)
    }
  }
  for (const platform of PROVIDER_PLATFORMS) llm.platformModels[platform] ??= seeds[platform]
  llm.cliVersions ??= {}
  llm.providers = (llm.providers ?? []).map((provider) => {
    const result = storedProvider(provider)
    try {
      result.apiHost = normalizeProviderEndpoint(result.apiHost)
    } catch {
      /* Keep invalid old addresses editable. */
    }
    // Remove stored identity headers; platform identity is generated only at request time.
    const clean = platformRequestHeaders(inferProviderPlatform(result), undefined, result.extra_headers)
    for (const key of ['User-Agent', 'originator', 'version', 'x-grok-client-version', 'x-grok-client-identifier'])
      delete clean[key]
    result.extra_headers = clean
    for (const key of ['healthCheck', 'healthStatus', 'modelStatuses', 'apiKeyConnectivity', 'latency'])
      delete (result as any)[key]
    return result
  })
  return state
}
