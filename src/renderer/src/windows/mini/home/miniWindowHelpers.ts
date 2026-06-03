import { isEmbeddingModel, isRerankModel } from '@renderer/config/models/embedding'
import { isVisionModel } from '@renderer/config/models/vision'
import type { Assistant, FileMetadata, Model, Provider, Topic } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { isComposingInputEvent } from '@renderer/utils/input'
import {
  createFileBlock,
  createImageBlock,
  createMainTextBlock,
  createMessage
} from '@renderer/utils/messageUtils/create'
import { imageExts } from '@shared/config/constant'
import { v4 as uuidv4 } from 'uuid'

type MiniKeyboardEvent = Parameters<typeof isComposingInputEvent>[0] & {
  code?: string
  key?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export const isMiniWindowChatModel = (model: Model): boolean => {
  return !isEmbeddingModel(model) && !isRerankModel(model)
}

export const getMiniWindowChatModels = (providers: Provider[]): Model[] => {
  return providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.filter(isMiniWindowChatModel))
}

export const getMiniWindowSupportExts = (assistant: Assistant): string[] => {
  return assistant.model && isVisionModel(assistant.model) ? [...imageExts] : []
}

export const updateMiniWindowDefaultAssistantModel = (defaultAssistant: Assistant, model: Model): Assistant => {
  return {
    ...defaultAssistant,
    model
  }
}

export const getMiniWindowPersistedTopic = (topic: Topic): Topic => ({
  ...topic,
  messages: []
})

export const getMiniWindowMessageWithBlock = (message: Message, blockId: string): Message => {
  if (message.blocks.includes(blockId)) {
    return message
  }

  return {
    ...message,
    blocks: [...message.blocks, blockId]
  }
}

export const isMiniWindowSendKeyPressed = (event: MiniKeyboardEvent): boolean => {
  if (isComposingInputEvent(event)) {
    return false
  }

  const isEnter = event.code === 'Enter' || event.code === 'NumpadEnter' || event.key === 'Enter'
  return Boolean(isEnter && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
}

export const isMiniWindowComposingInput = (event: MiniKeyboardEvent): boolean => isComposingInputEvent(event)

export const buildMiniWindowUserMessage = ({
  assistant,
  topic,
  content,
  files
}: {
  assistant: Assistant
  topic: Topic
  content?: string
  files?: FileMetadata[]
}) => {
  const messageId = uuidv4()
  const blocks: MessageBlock[] = []
  const blockIds: string[] = []

  if (content !== undefined) {
    const textBlock = createMainTextBlock(messageId, content, {
      status: MessageBlockStatus.SUCCESS
    })
    blocks.push(textBlock)
    blockIds.push(textBlock.id)
  }

  files?.forEach((file) => {
    const block =
      file.type === FILE_TYPE.IMAGE
        ? createImageBlock(messageId, { file, status: MessageBlockStatus.SUCCESS })
        : createFileBlock(messageId, file, { status: MessageBlockStatus.SUCCESS })
    blocks.push(block)
    blockIds.push(block.id)
  })

  const message = createMessage('user', topic.id, assistant.id, {
    id: messageId,
    modelId: assistant.model?.id,
    model: assistant.model,
    blocks: blockIds
  })

  return { message, blocks }
}
