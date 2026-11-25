/**
 * 职责：提供原子化的、无状态的API调用函数
 */
import { loggerService } from '@logger'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams'
import type { AiSdkMiddlewareConfig } from '@renderer/aiCore/types/middlewareConfig'
import { buildProviderOptions } from '@renderer/aiCore/utils/options'
import { isFunctionCallingModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import type { Assistant, Provider } from '@renderer/types'
import { type FetchChatCompletionParams, isSystemProvider } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import { getErrorMessage } from '@renderer/utils/error'
import { purifyMarkdownImages } from '@renderer/utils/markdown'
import { findFileBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { NOT_SUPPORT_API_KEY_PROVIDER_TYPES, NOT_SUPPORT_API_KEY_PROVIDERS } from '@renderer/utils/provider'
import type { ReasoningMode } from '@shared/reasoning'

import { AiProvider } from '../aiCore'
import {
  getDefaultAssistant,
  getDefaultModel,
  getProviderByModel,
  getQuickModel,
  requireCurrentModel
} from './AssistantService'
import { ConversationService } from './ConversationService'
import type { BlockManager } from './messageStreaming'
import type { StreamProcessor, StreamProcessorCallbacks } from './StreamProcessingService'

// FIXME: 这里太多重复逻辑，需要重构

const logger = loggerService.withContext('ApiService')

/**
 * 将用户消息转换为LLM可以理解的格式并发送请求
 * @param request - 包含消息内容和助手信息的请求对象
 * @param onChunkReceived - 接收流式响应数据的回调函数
 */
// 目前先按照函数来写,后续如果有需要到class的地方就改回来
export async function transformMessagesAndFetch(
  request: {
    messages: Message[]
    assistant: Assistant
    blockManager: BlockManager
    assistantMsgId: string
    callbacks: StreamProcessorCallbacks
    topicId?: string // 添加 topicId 用于 trace
    allowedTools?: string[]
    options: {
      signal?: AbortSignal
      headers?: Record<string, string>
      reasoningMode?: ReasoningMode
    }
  },
  onChunkReceived: StreamProcessor
) {
  const { messages } = request
  const assistant = { ...request.assistant }

  try {
    assistant.model = requireCurrentModel(assistant.model || getDefaultModel(), true)
    const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(messages, assistant)

    // replace prompt variables
    assistant.prompt = await replacePromptVariables(assistant.prompt, assistant.model?.name)

    await fetchChatCompletion({
      messages: modelMessages,
      assistant: assistant,
      topicId: request.topicId,
      allowedTools: request.allowedTools,
      requestOptions: request.options,
      uiMessages,
      onChunkReceived
    })
  } catch (error: any) {
    await onChunkReceived({ type: ChunkType.ERROR, error })
  }
}

/**
 * The chat request mode is frozen at the start of this call.
 */
export async function fetchChatCompletion({
  messages,
  prompt,
  assistant,
  requestOptions,
  onChunkReceived,
  topicId,
  uiMessages,
  allowedTools
}: FetchChatCompletionParams) {
  assistant = { ...assistant, model: requireCurrentModel(assistant.model || getDefaultModel(), true) }
  logger.info('fetchChatCompletion called with detailed context', {
    messageCount: messages?.length || 0,
    hasPrompt: typeof prompt === 'string' && prompt.length > 0,
    assistantId: assistant.id,
    topicId,
    hasTopicId: !!topicId,
    modelId: assistant.model?.id,
    modelName: assistant.model?.name
  })

  // Get base provider and apply API key rotation
  // NOTE: Shallow copy is intentional. Provider objects are not mutated by downstream code.
  // Nested properties (if any) are never modified after creation.
  const baseProvider = getProviderByModel(assistant.model || getDefaultModel())
  const providerWithRotatedKey = {
    ...baseProvider,
    apiKey: getRotatedApiKey(baseProvider)
  }

  const AI = new AiProvider(assistant.model || getDefaultModel(), providerWithRotatedKey)
  const provider = AI.getActualProvider()

  onChunkReceived({ type: ChunkType.LLM_RESPONSE_CREATED })

  if (prompt) {
    messages = [
      {
        role: 'user',
        content: prompt
      }
    ]
  }

  // 使用 transformParameters 模块构建参数
  const {
    params: aiSdkParams,
    modelId,
    capabilities
  } = await buildStreamTextParams(messages, assistant, provider, {
    allowedTools,
    requestOptions
  })

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: (requestOptions?.chatRequestMode ?? getStoreSetting('chatRequestMode') ?? 'stream') === 'stream',
    chatRequestMode: requestOptions?.chatRequestMode ?? getStoreSetting('chatRequestMode') ?? 'stream',
    onChunk: onChunkReceived,
    enableReasoning: capabilities.enableReasoning,
    reasoningMode: requestOptions?.reasoningMode,
    textDeltaMode: requestOptions?.textDeltaMode,
    isPromptToolUse: false,
    isSupportedToolUse: isFunctionCallingModel(assistant.model),
    enableGenerateImage: capabilities.enableGenerateImage,
    enableUrlContext: capabilities.enableUrlContext,
    uiMessages
  }

  // --- Call AI Completions ---
  await AI.completions(modelId, aiSdkParams, {
    ...middlewareConfig,
    assistant,
    topicId,
    callType: 'chat',
    uiMessages
  })
}

export async function fetchMessagesSummary({
  messages
}: {
  messages: Message[]
}): Promise<{ text: string | null; error?: string }> {
  let prompt = getStoreSetting('topicNamingPrompt') || i18n.t('prompts.title')
  const model = getQuickModel()
  if (!model) return { text: null }

  if (prompt && containsSupportedVariables(prompt)) {
    prompt = await replacePromptVariables(prompt, model.name)
  }

  // 总结上下文总是取最后5条消息
  const contextMessages = messages.slice(-5)
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return { text: null, error: i18n.t('error.no_api_key') }
  }

  // Apply API key rotation
  // NOTE: Shallow copy is intentional. Provider objects are not mutated by downstream code.
  // Nested properties (if any) are never modified after creation.
  const providerWithRotatedKey = {
    ...provider,
    apiKey: getRotatedApiKey(provider)
  }

  const AI = new AiProvider(model, providerWithRotatedKey)
  const actualProvider = AI.getActualProvider()

  const topicId = messages?.find((message) => message.topicId)?.topicId || ''

  // LLM对多条消息的总结有问题，用单条结构化的消息表示会话内容会更好
  const structredMessages = contextMessages.map((message) => {
    const structredMessage = {
      role: message.role,
      mainText: purifyMarkdownImages(getMainTextContent(message))
    }

    // 让LLM知道消息中包含的文件，但只提供文件名
    // 对助手消息而言，没有提供工具调用结果等更多信息，仅提供文本上下文。
    const fileBlocks = findFileBlocks(message)
    let fileList: Array<string> = []
    if (fileBlocks.length && fileBlocks.length > 0) {
      fileList = fileBlocks.map((fileBlock) => fileBlock.file.origin_name)
    }
    return {
      ...structredMessage,
      files: fileList.length > 0 ? fileList : undefined
    }
  })
  const conversation = JSON.stringify(structredMessages)

  const defaultAssistant = getDefaultAssistant()
  const summaryAssistant = {
    ...defaultAssistant,
    settings: {
      ...defaultAssistant.settings,
      reasoning_effort: 'max',
      qwenThinkMode: false
    },
    prompt,
    model
  } satisfies Assistant

  const { providerOptions, standardParams } = buildProviderOptions(summaryAssistant, model, actualProvider, {
    enableReasoning: false,
    enableGenerateImage: false
  })

  const llmMessages = {
    system: prompt,
    prompt: conversation,
    providerOptions,
    ...standardParams
  }

  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: false,
    chatRequestMode: 'non-stream',
    enableReasoning: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    enableGenerateImage: false,
    enableUrlContext: false
  }
  try {
    const { getText } = await AI.completions(model.id, llmMessages, {
      ...middlewareConfig,
      assistant: summaryAssistant,
      topicId,
      callType: 'summary'
    })

    const text = getText()
    const result = removeSpecialCharactersForTopicName(text)
    return result ? { text: result } : { text: null, error: i18n.t('error.no_response') }
  } catch (error: unknown) {
    return { text: null, error: getErrorMessage(error) }
  }
}

export function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (
    (isSystemProvider(provider) && NOT_SUPPORT_API_KEY_PROVIDERS.includes(provider.id)) ||
    NOT_SUPPORT_API_KEY_PROVIDER_TYPES.includes(provider.type)
  )
    return true
  return Boolean(provider.apiKey && provider.apiKey.trim().length > 0)
}

/**
 * Get rotated API key for providers that support multiple keys
 * Returns empty string for providers that don't require API keys
 */
function getRotatedApiKey(provider: Provider): string {
  // Handle providers that don't require API keys
  if (!provider.apiKey || provider.apiKey.trim() === '') {
    return ''
  }

  const keys = provider.apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  if (keys.length === 0) {
    return ''
  }

  const keyName = `provider:${provider.id}:last_used_key`

  // If only one key, return it directly
  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = window.keyv.get(keyName)
  if (!lastUsedKey) {
    window.keyv.set(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)

  // Log when the last used key is no longer in the list
  if (currentIndex === -1) {
    logger.debug('Last used API key no longer found in provider keys, falling back to first key', {
      providerId: provider.id,
      lastUsedKey: lastUsedKey.substring(0, 8) + '...' // Only log first 8 chars for security
    })
  }

  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  window.keyv.set(keyName, nextKey)

  return nextKey
}
