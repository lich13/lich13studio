import type { Assistant, FileMetadata, Usage } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { findFileBlocks, getMainTextContent, getThinkingContent } from '@renderer/utils/messageUtils/find'
import takeRight from 'lodash/takeRight'
import { approximateTokenSize } from 'tokenx'

import { getAssistantSettings } from './AssistantService'
import { filterAfterContextClearMessages, filterMessages } from './MessagesService'

const MAX_CACHED_MESSAGE_TOKENS = 512
const messageTokenCache = new Map<string, number>()

function hashTextFnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function getCachedMessageTokens(key: string): number | undefined {
  const cached = messageTokenCache.get(key)
  if (cached !== undefined) {
    messageTokenCache.delete(key)
    messageTokenCache.set(key, cached)
  }
  return cached
}

function setCachedMessageTokens(key: string, tokens: number) {
  if (messageTokenCache.size >= MAX_CACHED_MESSAGE_TOKENS) {
    const oldestKey = messageTokenCache.keys().next().value
    if (oldestKey !== undefined) {
      messageTokenCache.delete(oldestKey)
    }
  }
  messageTokenCache.set(key, tokens)
}

interface MessageItem {
  name?: string
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function getFileContent(file: FileMetadata) {
  if (!file) {
    return ''
  }

  if (file.type === FILE_TYPE.TEXT) {
    return await window.api.file.read(file.id + file.ext, true)
  }

  return ''
}

async function getMessageParam(message: Message): Promise<MessageItem[]> {
  const param: MessageItem[] = []

  const content = getMainTextContent(message)
  const files = findFileBlocks(message)

  param.push({
    role: message.role,
    content
  })

  if (files.length > 0) {
    for (const file of files) {
      param.push({
        role: 'assistant',
        content: await getFileContent(file.file)
      })
    }
  }

  return param
}

/**
 * 估算文本内容的 token 数量
 *
 * @param text - 需要估算的文本内容
 * @returns 返回估算的 token 数量
 */
export function estimateTextTokens(text: string) {
  return approximateTokenSize(text)
}

/**
 * 估算图片文件的 token 数量
 *
 * 根据图片文件大小计算预估的 token 数量。
 * 当前使用简单的文件大小除以 100 的方式进行估算。
 *
 * @param file - 图片文件对象
 * @returns 返回估算的 token 数量
 */
export function estimateImageTokens(file: FileMetadata) {
  return Math.floor(file.size / 100)
}

/**
 * 估算用户输入内容（文本和文件）的 token 用量。
 *
 * 该函数只根据传入的 content（文本内容）和 files（文件列表）估算，
 * 不依赖完整的 Message 结构，也不会处理消息块、上下文等信息。
 *
 * @param {Object} params - 输入参数对象
 * @param {string} [params.content] - 用户输入的文本内容
 * @param {FileMetadata[]} [params.files] - 用户上传的文件列表（支持图片和文本）
 * @returns {Promise<Usage>} 返回一个 Usage 对象，包含 prompt_tokens、completion_tokens、total_tokens
 */
export async function estimateUserPromptUsage({
  content,
  files
}: {
  content?: string
  files?: FileMetadata[]
}): Promise<Usage> {
  let imageTokens = 0

  if (files && files.length > 0) {
    const images = files.filter((f) => f.type === FILE_TYPE.IMAGE)
    if (images.length > 0) {
      for (const image of images) {
        imageTokens = estimateImageTokens(image) + imageTokens
      }
    }
  }

  const tokens = estimateTextTokens(content || '')

  return {
    prompt_tokens: tokens,
    completion_tokens: tokens,
    total_tokens: tokens + (imageTokens ? imageTokens - 7 : 0)
  }
}

/**
 * 估算完整消息（Message）的 token 用量。
 *
 * 该函数会自动从 message 中提取主文本内容、推理内容（reasoningContent）和所有文件块，
 * 统计文本和图片的 token 数量，适用于对完整消息对象进行 usage 估算。
 *
 * @param {Partial<Message>} message - 消息对象，可以是完整或部分 Message
 * @returns {Promise<Usage>} 返回一个 Usage 对象，包含 prompt_tokens、completion_tokens、total_tokens
 */
export async function estimateMessageUsage(message: Partial<Message>): Promise<Usage> {
  const fileBlocks = findFileBlocks(message as Message)
  const files = fileBlocks.map((f) => f.file)

  let imageTokens = 0

  if (files.length > 0) {
    const images = files.filter((f) => f.type === FILE_TYPE.IMAGE)
    if (images.length > 0) {
      for (const image of images) {
        imageTokens = estimateImageTokens(image) + imageTokens
      }
    }
  }

  const content = getMainTextContent(message as Message)
  const reasoningContent = getThinkingContent(message as Message)
  const combinedContent = [content, reasoningContent].filter((s) => s !== undefined).join(' ')
  const tokens = estimateTextTokens(combinedContent)

  return {
    prompt_tokens: tokens,
    completion_tokens: tokens,
    total_tokens: tokens + (imageTokens ? imageTokens - 7 : 0)
  }
}

export async function estimateMessagesUsage({
  assistant,
  messages
}: {
  assistant: Assistant
  messages: Message[]
}): Promise<Usage> {
  const outputMessage = messages.at(-1)
  if (!outputMessage) {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  }

  const historyMessages = messages.slice(0, -1)
  const prompt_tokens = await estimateHistoryTokens(assistant, historyMessages)
  const { completion_tokens } = await estimateMessageUsage(outputMessage)

  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens
  }
}

export async function estimateHistoryTokens(assistant: Assistant, msgs: Message[]) {
  const { contextCount } = getAssistantSettings(assistant)
  const maxContextCount = contextCount
  const messages = filterMessages(filterAfterContextClearMessages(takeRight(msgs, maxContextCount)))

  let usageTokens = 0
  let unmeasuredTokens = 0

  for (const message of messages) {
    if (message.usage) {
      const inputTokens = message.usage.total_tokens ?? 0
      const outputTokens = message.usage.completion_tokens ?? 0
      usageTokens += message.role === 'user' ? inputTokens : outputTokens
      continue
    }

    const content = getMainTextContent(message)
    const files = findFileBlocks(message)
    const filesKey = files.map((fileBlock) => `${fileBlock.file?.id ?? ''}:${fileBlock.file?.size ?? 0}`).join(',')
    const cacheKey = message.id
      ? `${message.id}|${message.updatedAt ?? message.createdAt ?? ''}|${content.length}:${hashTextFnv1a(content)}|${filesKey}`
      : ''
    const cached = cacheKey ? getCachedMessageTokens(cacheKey) : undefined
    if (cached !== undefined) {
      unmeasuredTokens += cached
      continue
    }

    const items = await getMessageParam(message)
    const joined = items.map((item) => item.content).join('\n')
    const tokens = estimateTextTokens(joined)
    if (cacheKey) {
      setCachedMessageTokens(cacheKey, tokens)
    }
    unmeasuredTokens += tokens
  }

  const promptTokens = assistant.prompt ? estimateTextTokens(assistant.prompt) : 0
  return promptTokens + unmeasuredTokens + usageTokens
}
