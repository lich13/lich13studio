import AiProvider from '@renderer/aiCore/AiProvider'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams/parameterBuilder'
import { getDefaultAssistant, getProviderByModel, requireCurrentModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'

import { MODEL_TEST_MAX_OUTPUT_TOKENS } from './OutputGuard'

/** Freeze routing, credentials and model settings once for the whole test session. */
export async function prepareDirectModelTest(selectedModel: Model) {
  const model = structuredClone(requireCurrentModel(selectedModel, true))
  const provider = structuredClone(getProviderByModel(model))
  // Model tests never rotate to another key during a retry.
  provider.apiKey =
    provider.apiKey
      .split(',')
      .map((key) => key.trim())
      .find(Boolean) || ''
  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.settings = {
    ...assistant.settings,
    customParameters: [],
    reasoning_effort: undefined,
    reasoning_effort_cache: undefined,
    qwenThinkMode: undefined,
    streamOutput: true,
    enableMaxToolCalls: false,
    toolUseMode: 'prompt'
  }
  assistant.enableUrlContext = false
  assistant.enableGenerateImage = false
  const ai = new AiProvider(model, provider)
  const { params } = await buildStreamTextParams([], assistant, ai.getActualProvider(), {
    allowedTools: [],
    requestOptions: { reasoningMode: 'disabled' }
  })
  return {
    target: { providerId: provider.id, providerName: provider.name, modelId: model.id },
    async execute(prompt: string, signal: AbortSignal, onChunk: (chunk: Chunk) => void) {
      signal.throwIfAborted()
      await ai.completions(
        model.id,
        {
          ...params,
          providerOptions: structuredClone(params.providerOptions),
          prompt: undefined,
          messages: [{ role: 'user', content: prompt }],
          abortSignal: signal,
          maxOutputTokens: MODEL_TEST_MAX_OUTPUT_TOKENS,
          maxRetries: 0
        },
        {
          assistant: structuredClone(assistant),
          streamOutput: true,
          reasoningMode: 'disabled',
          textDeltaMode: 'delta',
          enableReasoning: false,
          enableGenerateImage: false,
          enableUrlContext: false,
          isPromptToolUse: false,
          isSupportedToolUse: false,
          onChunk,
          callType: 'chat'
        }
      )
      signal.throwIfAborted()
    }
  }
}
