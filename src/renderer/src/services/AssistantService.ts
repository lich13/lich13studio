import {
  DEFAULT_CONTEXTCOUNT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_CONTEXT_COUNT,
  UNLIMITED_CONTEXT_COUNT
} from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models/embedding'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import {
  addAssistant,
  DEFAULT_ASSISTANT_SETTINGS,
  getDefaultAssistant,
  getDefaultTopic
} from '@renderer/store/assistants'
import type { Assistant, AssistantPreset, AssistantSettings, Model, Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils/naming'

export { DEFAULT_ASSISTANT_SETTINGS, getDefaultAssistant, getDefaultTopic }

/**
 * Gets the CURRENT SETTINGS of the default assistant.
 *
 * **Important**: This returns the actual current settings of the default assistant (user-configured),
 * NOT the DEFAULT_ASSISTANT_SETTINGS template. The settings may have been modified by the user
 * from their initial default values.
 *
 * To get the template of default values, use DEFAULT_ASSISTANT_SETTINGS directly.
 *
 * @returns Current settings of the default assistant from store state
 */
export function getDefaultAssistantSettings() {
  return store.getState().assistants.defaultAssistant.settings
}

export function getDefaultProvider() {
  return getProviderByModel(getDefaultModel())
}

const EMPTY_PROVIDER: Provider = {
  id: '',
  name: '',
  type: 'openai-response',
  apiKey: '',
  apiHost: '',
  models: [],
  enabled: false
}

export const EMPTY_MODEL: Model = { id: '', name: '', provider: '', group: '' }

function currentModelReference(model?: Model): Model | undefined {
  return (
    getStoreProviders()
      .find((provider) => provider.id === model?.provider)
      ?.models.find((entry) => entry.id === model?.id) ?? model
  )
}

export function getDefaultModel(): Model {
  const selected = store.getState().llm.defaultModel
  return currentModelReference(selected) ?? EMPTY_MODEL
}

export function getQuickModel() {
  return currentModelReference(store.getState().llm.quickModel)
}

export function getAssistantProvider(assistant: Assistant): Provider {
  return getProviderByModel(assistant.model || getDefaultModel())
}

export function getProviderById(id: string): Provider | undefined {
  return getStoreProviders().find((p) => p.id === id)
}

export function getProviderName(model?: Model): string {
  const provider = model?.provider ? getProviderById(model.provider) : undefined
  return provider ? getFancyProviderName(provider) : ''
}

/** A missing selection must never route a request to a different provider. */
export function getProviderByModel(model?: Model): Provider {
  return (model?.provider ? getProviderById(model.provider) : undefined) || EMPTY_PROVIDER
}

/** Resolve a saved reference against the latest shared catalog before sending. */
export function requireCurrentModel(model: Model, chatOnly = false): Model {
  const provider = getProviderByModel(model)
  const current = provider.models.find((entry) => entry.id === model.id)
  if (!provider.enabled || !current || (chatOnly && (isEmbeddingModel(current) || isRerankModel(current))))
    throw new Error(i18n.t('platform.select_model'))
  return current
}

/**
 * Retrieves and normalizes assistant settings with special transformation handling.
 *
 * **Special Transformations:**
 * 1. **Context Count**: Converts `MAX_CONTEXT_COUNT` to `UNLIMITED_CONTEXT_COUNT` for internal processing
 * 2. **Max Tokens**: Only returns a value when `enableMaxTokens` is true, otherwise returns `undefined`
 * 3. **Max Tokens Validation**: Ensures maxTokens > 0, falls back to `DEFAULT_MAX_TOKENS` if invalid
 * 4. **Fallback Defaults**: Applies system defaults for all undefined/missing settings
 *
 * @param assistant - The assistant instance to extract settings from
 * @returns Normalized assistant settings with all transformations applied
 */
export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const getAssistantMaxTokens = () => {
    if (assistant.settings?.enableMaxTokens) {
      const maxTokens = assistant.settings.maxTokens
      if (typeof maxTokens === 'number') {
        return maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
      }
      return DEFAULT_MAX_TOKENS
    }
    return undefined
  }

  return {
    contextCount: contextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : contextCount,
    temperature: assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE,
    enableTemperature: assistant?.settings?.enableTemperature ?? DEFAULT_ASSISTANT_SETTINGS.enableTemperature,
    topP: assistant?.settings?.topP ?? DEFAULT_ASSISTANT_SETTINGS.topP,
    enableTopP: assistant?.settings?.enableTopP ?? DEFAULT_ASSISTANT_SETTINGS.enableTopP,
    enableMaxTokens: assistant?.settings?.enableMaxTokens ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxTokens,
    maxTokens: getAssistantMaxTokens(),
    toolUseMode: assistant?.settings?.toolUseMode ?? DEFAULT_ASSISTANT_SETTINGS.toolUseMode,
    maxToolCalls: assistant?.settings?.maxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.maxToolCalls,
    enableMaxToolCalls: assistant?.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls,
    defaultModel: assistant?.defaultModel ?? DEFAULT_ASSISTANT_SETTINGS.defaultModel,
    reasoning_effort: assistant?.settings?.reasoning_effort ?? DEFAULT_ASSISTANT_SETTINGS.reasoning_effort,
    customParameters: assistant?.settings?.customParameters ?? DEFAULT_ASSISTANT_SETTINGS.customParameters
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

export async function createAssistantFromAgent(agent: AssistantPreset) {
  const assistantId = crypto.randomUUID()
  const topic = getDefaultTopic(assistantId)

  const assistant: Assistant = {
    ...agent,
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    topics: [topic],
    model: agent.defaultModel,
    type: 'assistant',
    regularPhrases: agent.regularPhrases || [], // Ensured regularPhrases
    settings: agent.settings || DEFAULT_ASSISTANT_SETTINGS
  }

  store.dispatch(addAssistant(assistant))

  window.toast.success(i18n.t('message.assistant.added.content'))

  return assistant
}
