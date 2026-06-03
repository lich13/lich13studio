import type { Assistant, FileMetadata, Model, Provider } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { MessageBlockType } from '@renderer/types/newMessage'
import { imageExts } from '@shared/config/constant'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'en-US', userAgent: 'Vitest' }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        notifyReduxStoreReady: vi.fn(async () => undefined)
      }
    }
  })
})

vi.mock('@renderer/config/models/embedding', () => ({
  isEmbeddingModel: (model: Model) =>
    model.capabilities?.some((capability) => capability.type === 'embedding') ?? false,
  isRerankModel: (model: Model) => model.capabilities?.some((capability) => capability.type === 'rerank') ?? false
}))

vi.mock('@renderer/config/models/vision', () => ({
  isVisionModel: (model: Model) =>
    model.capabilities?.find((capability) => capability.type === 'vision')?.isUserSelected ?? false
}))

import {
  buildMiniWindowUserMessage,
  getMiniWindowChatModels,
  getMiniWindowMessageWithBlock,
  getMiniWindowPersistedTopic,
  getMiniWindowSupportExts,
  isMiniWindowComposingInput,
  isMiniWindowSendKeyPressed,
  updateMiniWindowDefaultAssistantModel
} from './miniWindowHelpers'

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-5.1',
  name: 'GPT 5.1',
  provider: 'openai',
  group: 'openai',
  ...overrides
})

const createAssistant = (model = createModel()): Assistant => ({
  id: 'default-assistant',
  name: 'Default Assistant',
  prompt: '',
  topics: [],
  type: 'assistant',
  model
})

const createImageFile = (overrides: Partial<FileMetadata> = {}): FileMetadata => ({
  id: 'image-file',
  name: 'image-file.png',
  origin_name: 'clipboard.png',
  path: '/tmp/clipboard.png',
  size: 128,
  ext: '.png',
  type: FILE_TYPE.IMAGE,
  created_at: '2026-06-03T00:00:00.000Z',
  count: 1,
  ...overrides
})

describe('mini window helpers', () => {
  it('synchronizes model switching by updating the default assistant model', () => {
    const defaultAssistant = createAssistant(createModel({ id: 'gpt-5.1', name: 'GPT 5.1' }))
    const nextModel = createModel({ id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet', provider: 'anthropic' })

    const updated = updateMiniWindowDefaultAssistantModel(defaultAssistant, nextModel)

    expect(updated).toEqual({
      ...defaultAssistant,
      model: nextModel
    })
    expect(updated).not.toBe(defaultAssistant)
  })

  it('only accepts image paste extensions when the current model supports vision', () => {
    const visionAssistant = createAssistant(
      createModel({ id: 'gpt-5.1-vision', capabilities: [{ type: 'vision', isUserSelected: true }] })
    )
    const textAssistant = createAssistant(
      createModel({ id: 'text-model', capabilities: [{ type: 'vision', isUserSelected: false }] })
    )

    expect(getMiniWindowSupportExts(visionAssistant)).toEqual(imageExts)
    expect(getMiniWindowSupportExts(textAssistant)).toEqual([])
  })

  it('builds user messages with pasted image files as image blocks', () => {
    const assistant = createAssistant()
    const topic = {
      id: 'topic-id',
      assistantId: assistant.id,
      name: 'Mini Window',
      messages: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }

    const { message, blocks } = buildMiniWindowUserMessage({
      content: 'please describe this',
      assistant,
      topic,
      files: [createImageFile()]
    })

    expect(message.blocks).toHaveLength(2)
    expect(blocks).toEqual([
      expect.objectContaining({ type: MessageBlockType.MAIN_TEXT, content: 'please describe this' }),
      expect.objectContaining({ type: MessageBlockType.IMAGE, file: expect.objectContaining({ id: 'image-file' }) })
    ])
  })

  it('persists mini window topics without embedding volatile in-memory messages', () => {
    const topic = {
      id: 'topic-id',
      assistantId: 'default',
      name: 'Mini Window',
      messages: [{ id: 'message-id' }] as any,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }

    expect(getMiniWindowPersistedTopic(topic)).toEqual({
      ...topic,
      messages: []
    })
  })

  it('adds a streamed block reference to an assistant message only once', () => {
    const message = {
      id: 'assistant-message',
      role: 'assistant',
      assistantId: 'default',
      topicId: 'topic-id',
      createdAt: '2026-06-03T00:00:00.000Z',
      status: 'pending',
      blocks: ['existing-block']
    } as any

    expect(getMiniWindowMessageWithBlock(message, 'new-block').blocks).toEqual(['existing-block', 'new-block'])
    expect(getMiniWindowMessageWithBlock(message, 'existing-block').blocks).toEqual(['existing-block'])
  })

  it('does not send while the IME is composing text', () => {
    expect(
      isMiniWindowSendKeyPressed({
        code: 'Enter',
        key: 'Enter',
        nativeEvent: { isComposing: true }
      })
    ).toBe(false)

    expect(
      isMiniWindowSendKeyPressed({
        code: 'Enter',
        key: 'Enter',
        nativeEvent: { isComposing: false, keyCode: 13 }
      })
    ).toBe(true)
  })

  it('detects IME composition for non-send keys such as Escape', () => {
    expect(
      isMiniWindowComposingInput({
        code: 'Escape',
        key: 'Escape',
        nativeEvent: { keyCode: 229 }
      })
    ).toBe(true)
  })

  it('lists chat models from enabled providers only', () => {
    const enabledModel = createModel({ id: 'enabled-chat', provider: 'openai' })
    const disabledModel = createModel({ id: 'disabled-chat', provider: 'anthropic' })
    const embeddingModel = createModel({
      id: 'embedding',
      provider: 'openai',
      capabilities: [{ type: 'embedding', isUserSelected: true }]
    })

    const providers: Provider[] = [
      {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI',
        apiKey: '',
        apiHost: '',
        enabled: true,
        models: [enabledModel, embeddingModel]
      },
      {
        id: 'anthropic',
        type: 'anthropic',
        name: 'Anthropic',
        apiKey: '',
        apiHost: '',
        enabled: false,
        models: [disabledModel]
      }
    ]

    expect(getMiniWindowChatModels(providers)).toEqual([enabledModel])
  })
})
