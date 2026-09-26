/**
 * 参数构建模块
 * 构建AI SDK的流式和非流式参数
 */

import { combineHeaders } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@renderer/config/constant'
import {
  isAnthropicModel,
  isGeminiModel,
  isGenerateImageModel,
  isPureGenerateImageModel
} from '@renderer/config/models'
import { DEFAULT_ASSISTANT_SETTINGS, getDefaultModel, requireCurrentModel } from '@renderer/services/AssistantService'
import { type Assistant, type Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { replacePromptVariables } from '@renderer/utils/prompt'
import { isAwsBedrockProvider, isSupportUrlContextProvider } from '@renderer/utils/provider'
import type { ReasoningMode } from '@shared/reasoning'
import type { ModelMessage } from 'ai'
import { stepCountIs } from 'ai'

import type { ProviderCapabilities } from '../types'
import { buildProviderOptions } from '../utils/options'
import { addAnthropicHeaders } from './header'
import { getMaxTokens, getTemperature, getTopP } from './modelParameters'

const logger = loggerService.withContext('parameterBuilder')

/**
 * Validates and clamps maxToolCalls to valid range
 * Falls back to DEFAULT_ASSISTANT_SETTINGS.maxToolCalls if invalid
 * @param value - The maxToolCalls value from settings
 * @returns Validated maxToolCalls value
 */
function validateMaxToolCalls(value: number | undefined): number {
  if (value === undefined || value < MIN_TOOL_CALLS || value > MAX_TOOL_CALLS) {
    return DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  }
  return value
}

/**
 * 构建 AI SDK 流式参数
 * 这是主要的参数构建函数，整合所有转换逻辑
 */
export async function buildStreamTextParams(
  sdkMessages: StreamTextParams['messages'] = [],
  assistant: Assistant,
  provider: Provider,
  options: {
    allowedTools?: string[]
    requestOptions?: {
      signal?: AbortSignal
      headers?: Record<string, string | undefined>
      reasoningMode?: ReasoningMode
    }
  }
): Promise<{
  params: StreamTextParams
  modelId: string
  capabilities: ProviderCapabilities
}> {
  const { requestOptions = {} } = options
  const { signal: externalSignal, headers: inputHeaders = {}, reasoningMode = 'configured' } = requestOptions

  const model = requireCurrentModel(assistant.model || getDefaultModel())

  // 这三个变量透传出来，交给下面启用插件/中间件
  // 也可以在外部构建好再传入buildStreamTextParams
  // FIXME: qwen3即使关闭思考仍然会导致enableReasoning的结果为true
  const enableReasoning = reasoningMode === 'configured'

  // Validate provider and model support to prevent stale state from triggering urlContext
  const enableUrlContext = !!(
    assistant.enableUrlContext &&
    isSupportUrlContextProvider(provider) &&
    !isPureGenerateImageModel(model) &&
    (isGeminiModel(model) || isAnthropicModel(model))
  )

  const enableGenerateImage = !!(isGenerateImageModel(model) && assistant.enableGenerateImage)

  // 构建真正的 providerOptions
  const { providerOptions, standardParams } = buildProviderOptions(
    assistant,
    model,
    provider,
    {
      enableReasoning,
      enableGenerateImage
    },
    reasoningMode
  )

  let headers = inputHeaders

  if (isAnthropicModel(model) && !isAwsBedrockProvider(provider)) {
    const betaHeaders = addAnthropicHeaders(assistant, model)
    // Only add the anthropic-beta header if there are actual beta headers to include
    if (betaHeaders.length > 0) {
      const newBetaHeaders = { 'anthropic-beta': betaHeaders.join(',') }
      headers = combineHeaders(headers, newBetaHeaders)
    }
  }

  // 构建基础参数
  // Note: standardParams (topK, frequencyPenalty, presencePenalty, stopSequences, seed)
  // are extracted from custom parameters and passed directly to streamText()
  // instead of being placed in providerOptions

  // Get max tool calls from assistant settings
  // When enabled, validate and use user-defined value (1-100)
  // When disabled, don't pass stopWhen - let AI SDK use its own default
  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls

  const params: StreamTextParams = {
    messages: sdkMessages,
    maxOutputTokens: getMaxTokens(assistant, model, reasoningMode),
    temperature: getTemperature(assistant, model),
    topP: getTopP(assistant, model),
    // Include AI SDK standard params extracted from custom parameters
    ...standardParams,
    ...(externalSignal ? { abortSignal: externalSignal } : {}),
    headers,
    providerOptions,
    maxRetries: 0
  }

  // Only add stopWhen when explicitly enabled and validated
  if (enableMaxToolCalls) {
    const maxToolCalls = validateMaxToolCalls(assistant.settings?.maxToolCalls)
    params.stopWhen = stepCountIs(maxToolCalls)
  }
  // When disabled, don't pass stopWhen - let AI SDK use its own default

  const systemPrompt = assistant.prompt ? await replacePromptVariables(assistant.prompt, model.name) : ''

  if (systemPrompt) {
    params.system = systemPrompt
  }

  logger.debug('params', params)

  return {
    params,
    modelId: model.id,
    capabilities: { enableReasoning, enableGenerateImage, enableUrlContext }
  }
}

/**
 * 构建非流式的 generateText 参数
 */
export async function buildGenerateTextParams(
  messages: ModelMessage[],
  assistant: Assistant,
  provider: Provider,
  options: {
    allowedTools?: string[]
    enableTools?: boolean
  } = {}
): Promise<any> {
  // 复用流式参数的构建逻辑
  return await buildStreamTextParams(messages, assistant, provider, options)
}
