import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import type { Assistant, Model, Provider } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ provider: {} as Provider }))
vi.mock('@renderer/hooks/useSettings', () => ({ getStoreSetting: () => ({}), getEnableDeveloperMode: () => false }))
vi.mock('@renderer/services/AssistantService', () => ({
  requireCurrentModel: (model: Model) => model,
  getProviderByModel: () => fixture.provider,
  getDefaultAssistant: () => ({ id: 'test', prompt: '', settings: { customParameters: [], reasoning_effort: 'max' } }),
  getAssistantSettings: (assistant: Assistant) => assistant.settings,
  DEFAULT_ASSISTANT_SETTINGS: { enableTemperature: false, enableTopP: false, enableMaxToolCalls: false }
}))
vi.mock('@renderer/services/CliVersionService', () => ({
  getPlatformHeaders: () => ({ 'user-agent': 'test-cli/1.0.0' })
}))
vi.mock('@renderer/services/SpanManagerService', () => ({}))
vi.mock('@renderer/services/models/ModelAdapter', () => ({}))
vi.mock('@renderer/utils', () => ({ getLowerBaseModelName: (id: string) => id }))
vi.mock('@renderer/utils/prompt', () => ({ replacePromptVariables: (text: string) => text }))
vi.mock('@renderer/config/models', () => ({
  isAnthropicModel: (model: Model) => model.id.startsWith('claude-'),
  isGeminiModel: () => false,
  isGenerateImageModel: () => false,
  isPureGenerateImageModel: () => false,
  isClaudeReasoningModel: () => false,
  isReasoningModel: () => true,
  isMaxTemperatureOneModel: () => false,
  isSupportTemperatureModel: () => false,
  isSupportTopPModel: () => false,
  isTemperatureTopPMutuallyExclusiveModel: () => false,
  isClaude4SeriesModel: () => false,
  isClaude45ReasoningModel: () => false,
  isGemini3Model: () => false,
  isQwen35to39Model: () => false,
  isSupportedThinkingTokenQwenModel: (model: Model) => model.id.includes('qwen'),
  findTokenLimit: () => ({})
}))
vi.mock('@renderer/utils/provider', () => ({
  isAwsBedrockProvider: () => false,
  isSupportUrlContextProvider: () => false,
  isVertexProvider: () => false,
  isOllamaProvider: () => false,
  isSupportEnableThinkingProvider: () => false
}))
vi.mock('@renderer/aiCore/plugins/pdfCompatibilityPlugin', () => ({
  createPdfCompatibilityPlugin: () => ({ name: 'noop' })
}))
vi.mock('@renderer/aiCore/plugins/anthropicCachePlugin', () => ({}))
vi.mock('@renderer/aiCore/plugins/telemetryPlugin', () => ({}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), debug: vi.fn(), silly: vi.fn(), error: vi.fn(), warn: vi.fn() })
  }
}))

import AiProvider from '@renderer/aiCore/AiProvider'
import { buildStreamTextParams } from '@renderer/aiCore/prepareParams/parameterBuilder'
import { clearReasoningCapabilityCache } from '@renderer/aiCore/utils/reasoningFallback'

import { AnswerCollector } from './AnswerCollector'
import { prepareDirectModelTest } from './directModelTest'
import { ModelTestRunner } from './ModelTraceService'

beforeEach(() => {
  clearReasoningCapabilityCache()
  vi.stubGlobal('window', { __LICH13_TAURI_SHIM__: true })
  // Each SDK provider captures fetch; don't reuse a previous test's mock transport.
  for (const id of ['openai', 'anthropic']) extensionRegistry.get(id)?.clearCache()
})
afterEach(() => vi.unstubAllGlobals())

const sse = (events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
const responseEvents = [
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
  { type: 'response.output_text.delta', item_id: 'm', delta: '247 ' },
  { type: 'response.output_text.delta', item_id: 'm', delta: '18' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
  { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } }
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
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '247 ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '18' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: 'message_stop' }
]

describe('ModelTrace actual SDK request pipeline', () => {
  it('retries a real disconnected HTTP stream once, with unchanged target and request safeguards', async () => {
    const requests: Array<{ body: any; authorization?: string; url?: string }> = []
    let firstClosed = false
    let retriedAfterClose = false
    const answer = Array(80).fill('247').join(' ')
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (data) => {
        raw += data
      })
      request.on('end', () => {
        requests.push({ body: JSON.parse(raw), authorization: request.headers.authorization, url: request.url })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`data: ${JSON.stringify(responseEvents[0])}\n\n`)
        response.write(`data: ${JSON.stringify({ ...responseEvents[1], delta: answer })}\n\n`)
        if (requests.length === 1) {
          response.on('close', () => {
            firstClosed = true
          })
          setTimeout(() => response.destroy(), 20)
          return
        }
        if (requests.length === 2) retriedAfterClose = firstClosed
        for (const event of responseEvents.slice(3)) response.write(`data: ${JSON.stringify(event)}\n\n`)
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    fixture.provider = {
      id: 'local',
      name: 'Isolated mock',
      type: 'openai-response',
      apiHost: `http://127.0.0.1:${port}/v1`,
      apiKey: 'dummy-one,dummy-two',
      models: []
    }
    try {
      const challenges = [0, 1, 2].map((index) => ({
        id: String(index),
        expected_count: 303,
        prompt: `probe-${index}`
      }))
      const result = await new ModelTestRunner({
        model: { id: 'gpt-6-luna', name: '', provider: 'local', group: '' },
        challenges
      }).run()
      expect(requests).toHaveLength(4)
      expect(retriedAfterClose).toBe(true)
      expect(result.outputs.map((output) => output.attempts)).toEqual([2, 1, 1])
      expect(result.report?.used_outputs).toBe(3)
      expect(requests[0]).toEqual(requests[1])
      for (const request of requests) {
        expect(request.url).toBe('/v1/responses')
        expect(request.authorization).toBe('Bearer dummy-one')
        expect(request.body).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 4096 })
        for (const field of ['reasoning', 'thinking', 'tools', 'timeout'])
          expect(request.body).not.toHaveProperty(field)
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10000)

  it('does not let SDK retries multiply a temporary provider failure', async () => {
    fixture.provider = {
      id: 'local',
      name: 'Selected provider',
      type: 'openai-response',
      apiHost: 'http://127.0.0.1:18763/v1',
      apiKey: 'dummy',
      models: []
    }
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'temporarily unavailable', type: 'server_error' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
    )
    vi.stubGlobal('fetch', fetch)
    const session = await prepareDirectModelTest({ id: 'gpt-6-sol', name: 'Alias', provider: 'local', group: '' })
    await expect(session.execute('unchanged', new AbortController().signal, () => {})).rejects.toThrow(
      'temporarily unavailable'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not accept an SSE EOF without a successful provider terminal event', async () => {
    fixture.provider = {
      id: 'local',
      name: 'Selected provider',
      type: 'openai-response',
      apiHost: 'http://127.0.0.1:18763/v1',
      apiKey: 'dummy',
      models: []
    }
    vi.stubGlobal('fetch', async () => sse(responseEvents.slice(0, -1)))
    const session = await prepareDirectModelTest({ id: 'gpt-6-sol', name: 'Alias', provider: 'local', group: '' })
    const collector = new AnswerCollector()
    await session.execute('unchanged', new AbortController().signal, (chunk) => collector.accept(chunk)).catch(() => {})
    expect(collector.completed).toBe(false)
  })

  it.each(['empty', 'length'])('accepts a provider-confirmed %s response', async (mode) => {
    fixture.provider = {
      id: 'local',
      name: 'Selected provider',
      type: 'openai-response',
      apiHost: 'http://127.0.0.1:18763/v1',
      apiKey: 'dummy',
      models: []
    }
    const events =
      mode === 'empty'
        ? [responseEvents.at(-1)]
        : [
            ...responseEvents.slice(0, -1),
            {
              type: 'response.incomplete',
              response: {
                incomplete_details: { reason: 'max_output_tokens' },
                usage: { input_tokens: 10, output_tokens: 5 }
              }
            }
          ]
    vi.stubGlobal('fetch', async () => sse(events))
    const session = await prepareDirectModelTest({ id: 'gpt-6-sol', name: 'Alias', provider: 'local', group: '' })
    const collector = new AnswerCollector()
    await session.execute('unchanged', new AbortController().signal, (chunk) => collector.accept(chunk))
    expect(collector.completed).toBe(true)
    expect(collector.rawText).toBe(mode === 'empty' ? '' : '247 18')
  })

  it.each([
    ['openai-response', 'gpt-6-sol', 'responses'],
    ['openai-response', 'qwen3-test', 'responses'],
    ['anthropic', 'claude-sonnet-4-5', 'messages']
  ] as const)('sends %s / %s with no reasoning, tools, timeout or prompt rewriting', async (type, id, endpoint) => {
    fixture.provider = {
      id: 'local',
      name: 'Selected provider',
      type,
      apiHost: 'http://127.0.0.1:18763/v1',
      apiKey: 'dummy-one,dummy-two',
      models: []
    }
    const requests: any[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo, init: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
      return sse(type === 'anthropic' ? anthropicEvents : responseEvents)
    })
    const model: Model = { id, name: 'Alias', provider: 'local', group: '' }
    const session = await prepareDirectModelTest(model)
    fixture.provider.apiHost = 'http://wrong.invalid/v1'
    fixture.provider.apiKey = 'wrong-key'
    model.id = 'wrong-model'
    const chunks: any[] = []
    await session.execute('identical challenge', new AbortController().signal, (chunk) => chunks.push(chunk))
    await session.execute('identical challenge', new AbortController().signal, () => {})
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.url).toBe(`http://127.0.0.1:18763/v1/${endpoint}`)
      expect(request.body.model).toBe(id)
      expect(request.body[type === 'anthropic' ? 'max_tokens' : 'max_output_tokens']).toBe(4096)
      expect(request.headers.get(type === 'anthropic' ? 'x-api-key' : 'authorization')).toBe(
        type === 'anthropic' ? 'dummy-one' : 'Bearer dummy-one'
      )
      for (const field of [
        'reasoning',
        'reasoning_effort',
        'thinking',
        'output_config',
        'enable_thinking',
        'tools',
        'timeout',
        'textDeltaMode'
      ])
        expect(request.body[field]).toBeUndefined()
      expect(JSON.stringify(request.body)).not.toMatch(/\/no_think|\/think/)
      expect(JSON.stringify(request.body)).toContain('identical challenge')
    }
    expect(chunks.filter((chunk) => chunk.type === ChunkType.TEXT_DELTA).map((chunk) => chunk.text)).toEqual([
      '247 ',
      '18'
    ])
    expect(chunks.find((chunk) => chunk.type === ChunkType.TEXT_COMPLETE).text).toBe('247 18')
  })
})

it('negotiates max through the real Responses SDK without emitting rejected attempts', async () => {
  fixture.provider = {
    id: 'local',
    name: 'Local',
    type: 'openai-response',
    apiHost: 'http://127.0.0.1:18763/v1',
    apiKey: 'dummy',
    models: []
  }
  const requests: any[] = []
  vi.stubGlobal('fetch', async (_input: RequestInfo, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    if (body.reasoning.effort === 'max')
      return new Response(
        JSON.stringify({
          error: {
            message: "Unsupported value for reasoning.effort: max. Supported values are: ['low', 'medium', 'high']",
            param: 'reasoning.effort',
            code: 'unsupported_value'
          }
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    return sse(responseEvents)
  })
  const model = { id: 'gpt-6-sol', name: 'Sol', provider: 'local', group: '' }
  const assistant = { id: 'a', prompt: '', model, settings: { reasoning_effort: 'max' } } as Assistant
  const ai = new AiProvider(model, fixture.provider)
  const { params } = await buildStreamTextParams(
    [{ role: 'user', content: 'original' }],
    assistant,
    fixture.provider,
    {}
  )
  const chunks: any[] = []
  await ai.completions(model.id, params, {
    assistant,
    streamOutput: true,
    enableReasoning: true,
    reasoningMode: 'configured',
    textDeltaMode: 'delta',
    enableGenerateImage: false,
    enableUrlContext: false,
    isPromptToolUse: false,
    isSupportedToolUse: false,
    callType: 'chat',
    onChunk: (chunk) => {
      chunks.push(chunk)
    }
  })
  expect(requests.map((body) => body.reasoning.effort)).toEqual(['max', 'high'])
  expect(requests[0].input).toEqual(requests[1].input)
  expect(requests.every((body) => body.model === 'gpt-6-sol')).toBe(true)
  expect(chunks.some((chunk) => chunk.type === ChunkType.ERROR)).toBe(false)
  expect(
    chunks
      .filter((chunk) => chunk.type === ChunkType.TEXT_DELTA)
      .map((chunk) => chunk.text)
      .join('')
  ).toBe('247 18')
})
