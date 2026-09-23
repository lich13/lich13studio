import { getStoreSetting } from '@renderer/hooks/useSettings'
import type { Assistant, Model, Provider } from '@renderer/types'
import { type AiSdkParam, isAiSdkParam } from '@renderer/types/aiCoreTypes'
import type { JSONValue } from 'ai'

import { getAiSdkProviderId } from '../provider/factory'
import type { ProviderCapabilities } from '../types'
import { getAnthropicReasoningParams, getCustomParameters, getOpenAIReasoningParams } from './reasoning'

export function buildProviderOptions(
  assistant: Assistant,
  model: Model,
  provider: Provider,
  _capabilities: Pick<ProviderCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
): { providerOptions: Record<string, Record<string, JSONValue>>; standardParams: Partial<Record<AiSdkParam, any>> } {
  void _capabilities
  const id = getAiSdkProviderId(provider)
  const { standardParams, providerParams } = extractAiSdkStandardParams(getCustomParameters(assistant))
  // Strength has one source of truth; custom parameters must not override the selector.
  for (const key of [
    'reasoning',
    'reasoningEffort',
    'reasoning_effort',
    'thinking',
    'effort',
    'output_config',
    'openai',
    'anthropic'
  ])
    delete providerParams[key]
  const options =
    id === 'openai'
      ? {
          ...providerParams,
          ...getOpenAIReasoningParams(assistant, model),
          forceReasoning: true,
          store: false,
          serviceTier: provider.serviceTier,
          textVerbosity: getStoreSetting('openAI')?.verbosity
        }
      : { ...providerParams, ...getAnthropicReasoningParams(assistant, model) }
  return { providerOptions: { [id]: options as Record<string, JSONValue> }, standardParams }
}

function extractAiSdkStandardParams(customParams: Record<string, any>): {
  standardParams: Partial<Record<AiSdkParam, any>>
  providerParams: Record<string, any>
} {
  const standardParams: Partial<Record<AiSdkParam, any>> = {}
  const providerParams: Record<string, any> = {}

  for (const [key, value] of Object.entries(customParams)) {
    if (isAiSdkParam(key)) {
      standardParams[key] = value
    } else {
      providerParams[key] = value
    }
  }

  return { standardParams, providerParams }
}
