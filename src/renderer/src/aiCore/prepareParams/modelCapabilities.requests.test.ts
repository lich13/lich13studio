// @vitest-environment jsdom
import type { Assistant, Model, Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType, UserMessageStatus } from '@renderer/types/newMessage'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  provider: {} as Provider,
  blocks: new Map<string, MessageBlock>(),
  catalog: {
    providers: [] as any[],
    platformModels: { openai: [] as any[], grok: [] as any[], anthropic: [] as any[] }
  }
}))
const executorFixture = vi.hoisted(() => ({
  createExecutor: undefined as (() => unknown) | undefined
}))

vi.mock('@cherrystudio/ai-core', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    createExecutor: (...args: unknown[]) =>
      executorFixture.createExecutor ? executorFixture.createExecutor() : actual.createExecutor(...args)
  }
})

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: () => ({}),
  getEnableDeveloperMode: () => false
}))
vi.mock('@renderer/services/AssistantService', () => ({
  requireCurrentModel: (model: Model) => model,
  getProviderByModel: () => fixture.provider,
  getDefaultModel: () => fixture.provider.models[0],
  getDefaultAssistant: () => ({ id: 'test', prompt: '', settings: {} }),
  getAssistantSettings: (assistant: Assistant) => ({
    enableTemperature: false,
    enableTopP: false,
    enableMaxToolCalls: false,
    enableMaxTokens: true,
    maxTokens: 128,
    reasoning_effort: 'max',
    contextCount: 0,
    ...assistant.settings
  }),
  DEFAULT_ASSISTANT_SETTINGS: {
    enableTemperature: false,
    enableTopP: false,
    enableMaxToolCalls: false,
    enableMaxTokens: true,
    maxTokens: 128,
    reasoning_effort: 'max',
    temperature: 1,
    topP: 1,
    maxToolCalls: 1
  }
}))
vi.mock('@renderer/services/CliVersionService', () => ({ getPlatformHeaders: () => ({}) }))
vi.mock('@renderer/services/SpanManagerService', () => ({}))
vi.mock('@renderer/services/ReasoningUsageService', () => ({
  reasoningUsage: { subscribe: () => () => {}, get: () => undefined, set: vi.fn() }
}))
vi.mock('@renderer/services/models/ModelAdapter', () => ({
  normalizeGatewayModels: (_provider: Provider, models: Model[]) => models
}))
vi.mock('@renderer/utils/prompt', () => ({ replacePromptVariables: (text: string) => text }))
vi.mock('@renderer/utils/provider', () => ({
  isAwsBedrockProvider: () => false,
  isSupportUrlContextProvider: () => false,
  isVertexProvider: () => false,
  isOllamaProvider: () => false,
  isSupportEnableThinkingProvider: () => false
}))
vi.mock('@renderer/aiCore/plugins/PluginBuilder', () => ({ buildPlugins: () => [] }))
vi.mock('@renderer/aiCore/plugins/pdfCompatibilityPlugin', () => ({
  createPdfCompatibilityPlugin: () => ({ name: 'noop' })
}))
vi.mock('@renderer/aiCore/plugins/anthropicCachePlugin', () => ({}))
vi.mock('@renderer/aiCore/prepareParams/fileProcessor', () => ({
  convertFileBlockToFilePart: async () => null,
  convertFileBlockToTextPart: async () => null
}))
vi.mock('@renderer/store', () => ({
  default: { getState: () => ({}) },
  useAppSelector: (select: (state: { llm: typeof fixture.catalog }) => unknown) => select({ llm: fixture.catalog })
}))
vi.mock('@renderer/store/messageBlock', () => ({
  messageBlocksSelectors: { selectById: (_state: unknown, id: string) => fixture.blocks.get(id) }
}))
vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => null }))
vi.mock('@renderer/components/ModelTagsWithLabel', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<any>()
  const { createElement: h } = await import('react')
  return {
    ...actual,
    Tooltip: ({ children }: any) => children,
    Typography: { Text: ({ children, ...props }: any) => h('span', props, children) },
    Select: ({ options, value, onChange, disabled, 'aria-label': label }: any) =>
      h(
        'select',
        {
          'aria-label': label,
          value: value || '',
          disabled,
          onChange: (event: any) => onChange(event.target.value)
        },
        [
          h('option', { key: 'empty', value: '' }, 'Select'),
          ...options.flatMap((entry: any) =>
            (entry.options || [entry]).map((option: any) =>
              h('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label)
            )
          )
        ]
      )
  }
})
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), debug: vi.fn(), silly: vi.fn(), error: vi.fn(), warn: vi.fn() })
  }
}))

import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import AiProvider from '@renderer/aiCore/AiProvider'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams/parameterBuilder'
import { clearReasoningCapabilityCache } from '@renderer/aiCore/utils/reasoningFallback'
import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import { isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import { resolveModelCapabilities } from '@renderer/config/models/capabilities'
import { ConversationService } from '@renderer/services/ConversationService'
import { getMiniWindowChatModels } from '@renderer/windows/mini/home/miniWindowHelpers'
import { resolveModelTestSelection } from '@shared/modelTestSelection'

const openAiEvents = [
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
  { type: 'response.output_text.delta', item_id: 'm', delta: 'ok' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
  { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 1 } } }
]
const anthropicEvents = [
  {
    type: 'message_start',
    message: {
      id: 'm',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-5',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 }
    }
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: 'message_stop' }
]
const sse = (events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })

function makeProvider(type: Provider['type'], id = 'local'): Provider {
  return {
    id,
    name: 'Local request fixture',
    type,
    apiHost: 'http://127.0.0.1:18763/v1',
    apiKey: 'not-a-real-api-key',
    models: []
  }
}

function makeModel(id: string, provider = 'local', extra: Partial<Model> = {}): Model {
  return { id, name: id, group: '', provider, ...extra }
}

function makeAssistant(model: Model): Assistant {
  return {
    id: 'assistant-fixture',
    name: 'Request fixture',
    prompt: '',
    model,
    settings: { contextCount: 0, reasoning_effort: 'max', customParameters: [] }
  } as Assistant
}

function imageConversation(): Message[] {
  const messageId = 'user-image-message'
  const textId = `${messageId}-text`
  const imageId = `${messageId}-image`
  fixture.blocks.set(textId, {
    id: textId,
    messageId,
    type: MessageBlockType.MAIN_TEXT,
    content: 'Inspect this image',
    createdAt: '2026-09-27T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS
  } as MessageBlock)
  fixture.blocks.set(imageId, {
    id: imageId,
    messageId,
    type: MessageBlockType.IMAGE,
    url: 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==',
    createdAt: '2026-09-27T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS
  } as MessageBlock)
  return [
    {
      id: messageId,
      role: 'user',
      assistantId: 'assistant-fixture',
      topicId: 'topic-fixture',
      createdAt: '2026-09-27T00:00:00.000Z',
      status: UserMessageStatus.SUCCESS,
      blocks: [textId, imageId]
    }
  ]
}

function middleware(assistant: Assistant) {
  return {
    assistant,
    streamOutput: true,
    enableReasoning: false,
    reasoningMode: 'disabled' as const,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    enableGenerateImage: false,
    enableUrlContext: false,
    callType: 'chat'
  }
}

async function runSdkRequest(model: Model, provider: Provider, assistant: Assistant, messages: any[], params?: any) {
  const ai = new AiProvider(model, provider)
  await ai.completions(model.id, params ?? { messages, maxOutputTokens: 32, maxRetries: 0 }, middleware(assistant))
}

let root: ReturnType<typeof createRoot> | undefined
const imageData = 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw=='

beforeEach(() => {
  fixture.blocks.clear()
  fixture.catalog = { providers: [], platformModels: { openai: [], grok: [], anthropic: [] } }
  executorFixture.createExecutor = undefined
  clearReasoningCapabilityCache()
  for (const id of ['openai', 'anthropic']) extensionRegistry.get(id)?.clearCache()
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  vi.unstubAllGlobals()
})

describe('model capability request pipeline', () => {
  it.each(['gpt-6-luna', 'gpt-6.1-sol'])(
    'serializes %s images and honors a manual vision opt-out without changing the ID',
    async (id) => {
      const provider = makeProvider('openai-response')
      fixture.provider = provider
      const requests: any[] = []
      vi.stubGlobal('fetch', async (_input: RequestInfo, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)))
        return sse(openAiEvents)
      })

      const model = makeModel(id)
      const assistant = makeAssistant(model)
      const prepared = await ConversationService.prepareMessagesForModel(imageConversation(), assistant)
      expect(prepared.modelMessages).toHaveLength(1)
      await runSdkRequest(model, provider, assistant, prepared.modelMessages)

      const optOutModel = makeModel(id, 'local', {
        capabilities: [{ type: 'vision', isUserSelected: false }]
      })
      const optOutAssistant = makeAssistant(optOutModel)
      const optOut = await ConversationService.prepareMessagesForModel(imageConversation(), optOutAssistant)
      await runSdkRequest(optOutModel, provider, optOutAssistant, optOut.modelMessages)

      expect(requests).toHaveLength(2)
      expect(requests.map((request) => request.model)).toEqual([id, id])
      expect(requests[0].input[0].content).toContainEqual({ type: 'input_image', image_url: imageData })
      expect(requests[1].input[0].content.some((part: any) => part.type === 'input_image')).toBe(false)
    }
  )

  it.each(['claude-sonnet-4-5', 'claude-sonnet-5-5'])('serializes %s images as Anthropic base64 blocks', async (id) => {
    const provider = makeProvider('anthropic', 'claude-local')
    fixture.provider = provider
    const requests: any[] = []
    vi.stubGlobal('fetch', async (_input: RequestInfo, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)))
      return sse(anthropicEvents)
    })

    const model = makeModel(id, 'claude-local')
    const assistant = makeAssistant(model)
    const prepared = await ConversationService.prepareMessagesForModel(imageConversation(), assistant)
    await runSdkRequest(model, provider, assistant, prepared.modelMessages)

    expect(requests).toHaveLength(1)
    expect(requests[0].model).toBe(id)
    expect(requests[0].messages[0].content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZS1pbWFnZS1ieXRlcw==' }
    })
  })

  it('uses the live catalog and capability filters for chat, mini, and model-test targets', async () => {
    for (const id of [
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-6-astra',
      'gpt-6.1-sol',
      'claude-sonnet-5-5',
      'openai/gpt-6-luna'
    ])
      expect(isVisionModel(makeModel(id))).toBe(true)

    const dottedCode = resolveModelCapabilities(makeModel('gpt-5.3-codex'))
    const hyphenCode = resolveModelCapabilities(makeModel('gpt-5-3-codex'))
    expect(dottedCode.registryId).toBe('gpt-5-3-codex')
    expect(dottedCode).toEqual(hyphenCode)

    const embedding = makeModel('bce-embedding-base-v1')
    const reranker = makeModel('bce-reranker-base')
    expect(isEmbeddingModel(embedding)).toBe(true)
    expect(isRerankModel(reranker)).toBe(true)

    const chatModel = makeModel('gpt-6-luna')
    const models = [chatModel, embedding, reranker]
    const provider = { ...makeProvider('openai-response'), enabled: true, models }
    fixture.catalog = {
      providers: [provider],
      platformModels: {
        openai: models.map((model) => {
          const definition: Partial<Model> = { ...model }
          delete definition.provider
          return definition
        }),
        grok: [],
        anthropic: []
      }
    }

    const selection = { platform: 'openai' as const, modelId: 'gpt-6-luna', providerId: 'local' }
    const firstTarget = resolveModelTestSelection(selection, fixture.catalog as any)
    expect(firstTarget.model?.id).toBe('gpt-6-luna')
    fixture.catalog.platformModels.openai[0] = {
      ...fixture.catalog.platformModels.openai[0],
      name: 'Catalog updated Luna',
      capabilities: [{ type: 'vision', isUserSelected: false }]
    }
    const updatedTarget = resolveModelTestSelection(selection, fixture.catalog as any)
    expect(updatedTarget.model?.name).toBe('Catalog updated Luna')
    expect(isVisionModel(updatedTarget.model)).toBe(false)

    const miniModels = getMiniWindowChatModels([provider as Provider])
    expect(miniModels.map((model) => model.id)).toEqual(['gpt-6-luna'])

    const container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(container)
    await act(async () =>
      root!.render(
        createElement(ModelProviderSelect, {
          selection,
          onChange: () => {}
        })
      )
    )
    const modelOptions = [...container.querySelectorAll('select')[0].options].map((option) => option.value)
    expect(modelOptions).toContain(JSON.stringify(['openai', 'gpt-6-luna']))
    expect(modelOptions).not.toContain(JSON.stringify(['openai', 'bce-embedding-base-v1']))
    expect(modelOptions).not.toContain(JSON.stringify(['openai', 'bce-reranker-base']))
    await act(async () => root!.unmount())
    root = undefined
    container.remove()
  })

  it.each([
    {
      label: 'known Luna with reasoning manually disabled',
      model: makeModel('gpt-6-luna', 'local', {
        capabilities: [{ type: 'reasoning', isUserSelected: false }]
      })
    },
    {
      label: 'unknown GPT without capability declarations',
      model: makeModel('gpt-6-custom-preview')
    },
    {
      label: 'official Sol with reasoning manually disabled',
      model: makeModel('gpt-6.1-sol', 'local', {
        capabilities: [{ type: 'reasoning', isUserSelected: false }]
      })
    },
    {
      label: 'official Grok non-reasoning alias',
      model: makeModel('grok-4.20-non-reasoning')
    }
  ])('omits reasoning from $label requests', async ({ model }) => {
    const provider = makeProvider('openai-response')
    fixture.provider = provider
    const requests: any[] = []
    vi.stubGlobal('fetch', async (_input: RequestInfo, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)))
      return sse(openAiEvents)
    })

    const assistant = makeAssistant(model)
    const { params, modelId } = await buildStreamTextParams(
      [{ role: 'user', content: 'plain text request' }],
      assistant,
      provider,
      {}
    )
    expect(modelId).toBe(model.id)
    expect(params.providerOptions?.openai).not.toHaveProperty('reasoningEffort')
    expect(params.providerOptions?.openai).not.toHaveProperty('forceReasoning')
    await runSdkRequest(model, provider, assistant, params.messages || [], params)

    expect(requests).toHaveLength(1)
    expect(requests[0].model).toBe(model.id)
    expect(requests[0]).not.toHaveProperty('reasoning')
  })

  it('preserves synchronous usage returned by non-stream generateText', async () => {
    const provider = makeProvider('openai-response')
    const model = makeModel('gpt-6-luna')
    fixture.provider = provider
    const usage = { inputTokens: 10, outputTokens: 1, totalTokens: 11 }
    const generateText = vi.fn(async () => ({ text: 'non-stream answer', usage, finishReason: 'stop' }))
    const createExecutor = vi.fn(async () => ({ generateText }))
    executorFixture.createExecutor = createExecutor

    const ai = new AiProvider(model, provider)
    const result = await ai.completions(
      model.id,
      { messages: [{ role: 'user', content: 'plain text request' }], maxRetries: 0 } as StreamTextParams,
      { ...middleware(makeAssistant(model)), chatRequestMode: 'non-stream' }
    )

    expect(result.getText()).toBe('non-stream answer')
    expect(result.usage).toBe(usage)
    expect(createExecutor).toHaveBeenCalledTimes(1)
    expect(generateText).toHaveBeenCalledTimes(1)
  })
})
