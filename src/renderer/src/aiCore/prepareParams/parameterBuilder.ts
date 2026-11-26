import { combineHeaders } from '@ai-sdk/provider-utils'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@renderer/config/constant'
import { isAnthropicModel, isGeminiModel, isPureGenerateImageModel, isReasoningModel } from '@renderer/config/models'
import { DEFAULT_ASSISTANT_SETTINGS, getDefaultModel, requireCurrentModel } from '@renderer/services/AssistantService'
import type { Assistant, Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { isSupportUrlContextProvider } from '@renderer/utils/provider'
import type { ReasoningMode } from '@shared/reasoning'
import { stepCountIs } from 'ai'

import type { ProviderCapabilities } from '../types'
import { buildProviderOptions } from '../utils/options'
import { addAnthropicHeaders } from './header'
import { getMaxTokens, getTemperature, getTopP } from './modelParameters'

function validateMaxToolCalls(value: number | undefined): number {
  if (value === undefined || value < MIN_TOOL_CALLS || value > MAX_TOOL_CALLS) {
    return DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  }
  return value
}

export async function buildStreamTextParams(
  sdkMessages: StreamTextParams['messages'] = [],
  assistant: Assistant,
  provider: Provider,
  options: {
    requestOptions?: {
      signal?: AbortSignal
      headers?: Record<string, string | undefined>
      reasoningMode?: ReasoningMode
    }
  } = {}
): Promise<{
  params: StreamTextParams
  modelId: string
  capabilities: ProviderCapabilities
}> {
  const { requestOptions = {} } = options
  const { signal: externalSignal, headers: inputHeaders = {}, reasoningMode = 'configured' } = requestOptions

  const model = requireCurrentModel(assistant.model || getDefaultModel(), true)
  const enableReasoning = reasoningMode === 'configured' && isReasoningModel(model)

  const enableUrlContext = !!(
    assistant.enableUrlContext &&
    isSupportUrlContextProvider(provider) &&
    !isPureGenerateImageModel(model) &&
    (isGeminiModel(model) || isAnthropicModel(model))
  )

  const { providerOptions, standardParams } = buildProviderOptions(
    assistant,
    model,
    provider,
    { enableReasoning },
    reasoningMode
  )

  let headers = inputHeaders

  if (enableReasoning && isAnthropicModel(model)) {
    const betaHeaders = addAnthropicHeaders(assistant, model)
    if (betaHeaders.length > 0) {
      headers = combineHeaders(headers, { 'anthropic-beta': betaHeaders.join(',') })
    }
  }

  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls

  const params: StreamTextParams = {
    messages: sdkMessages,
    maxOutputTokens: getMaxTokens(assistant, model, enableReasoning ? reasoningMode : 'disabled'),
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    ...standardParams,
    ...(externalSignal ? { abortSignal: externalSignal } : {}),
    headers,
    providerOptions,
    maxRetries: 0
  }

  if (enableMaxToolCalls) {
    const maxToolCalls = validateMaxToolCalls(assistant.settings?.maxToolCalls)
    params.stopWhen = stepCountIs(maxToolCalls)
  }

  const systemPrompt = assistant.prompt ? await replacePromptVariables(assistant.prompt, model.name) : ''
  if (systemPrompt) {
    params.system = systemPrompt
  }

  return {
    params,
    modelId: model.id,
    capabilities: { enableReasoning, enableUrlContext }
  }
}
