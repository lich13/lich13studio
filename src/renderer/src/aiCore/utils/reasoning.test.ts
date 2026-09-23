import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { Assistant, Model, Provider } from '@renderer/types'
import { REASONING_EFFORTS } from '@shared/reasoning'
import { describe, expect, it, vi } from 'vitest'

import { extensionRegistry } from '../../../../../packages/aiCore/src/core/providers/core/ExtensionRegistry'
import { createExecutor } from '../../../../../packages/aiCore/src/core/runtime'

vi.mock('@renderer/hooks/useSettings', () => ({ getStoreSetting: () => ({}) }))
vi.mock('@renderer/config/models', () => ({
  findTokenLimit: () => ({ max: 16384 }),
  isClaudeReasoningModel: () => true,
  isMaxTemperatureOneModel: () => false,
  isSupportedFlexServiceTier: () => false,
  isSupportTemperatureModel: () => false,
  isSupportTopPModel: () => false,
  isTemperatureTopPMutuallyExclusiveModel: () => false
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn() }) } }))
vi.mock('@renderer/services/AssistantService', () => ({
  DEFAULT_ASSISTANT_SETTINGS: { reasoning_effort: 'max' },
  getAssistantSettings: (assistant: Assistant) => ({ reasoning_effort: 'max', ...assistant.settings }),
  getProviderByModel: () => ({ type: 'anthropic' })
}))
import { getMaxTokens } from '../prepareParams/modelParameters'
import { buildProviderOptions } from './options'

const model = (id: string): Model => ({ id, name: id, provider: 'local', group: '' })
const assistant = (effort?: string): Assistant => ({
  id: 'a',
  name: 'a',
  type: 'assistant',
  prompt: '',
  topics: [],
  settings: { reasoning_effort: effort as any, maxTokens: 8192, enableMaxTokens: true }
})
const provider = (type: Provider['type']): Provider => ({
  id: 'local',
  name: 'local',
  type,
  apiHost: 'http://127.0.0.1:45678/v1',
  apiKey: 'simulation-only',
  models: []
})
const capabilities = { enableReasoning: true, enableWebSearch: false, enableGenerateImage: false }
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'simulated request' }] }]

async function capture(type: Provider['type'], id: string, effort?: string) {
  const requests: any[] = []
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response(
      JSON.stringify({ type: 'error', error: { message: 'simulated rejection', type: 'invalid_request_error' } }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }
  const sdk =
    type === 'anthropic'
      ? createAnthropic({ baseURL: provider(type).apiHost, apiKey: 'simulation-only', fetch: fetcher })(id)
      : createOpenAI({ baseURL: provider(type).apiHost, apiKey: 'simulation-only', fetch: fetcher }).responses(id)
  const a = assistant(effort),
    m = model(id)
  const options = buildProviderOptions(a, m, provider(type), capabilities)
  await expect(
    sdk.doGenerate({
      prompt,
      providerOptions: options.providerOptions,
      maxOutputTokens: type === 'anthropic' ? getMaxTokens(a, m) : undefined
    })
  ).rejects.toThrow('simulated rejection')
  expect(requests).toHaveLength(1)
  return requests[0]
}

describe('actual SDK HTTP reasoning payloads', () => {
  it.each(['openai', 'anthropic'] as const)(
    'initializes the %s executor without application extension side effects',
    async (id) => {
      extensionRegistry.clear()
      const requests: string[] = []
      const executor = await createExecutor(id, {
        apiKey: 'simulation-only',
        baseURL: 'http://127.0.0.1:45678/v1',
        fetch: async (input) => {
          requests.push(String(input))
          return new Response(
            JSON.stringify({ type: 'error', error: { message: 'simulated rejection', type: 'invalid_request_error' } }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      })
      await expect(
        executor.generateText({
          model: id === 'openai' ? 'gpt-6-test' : 'claude-opus-4-7',
          prompt: 'local test',
          maxRetries: 0
        })
      ).rejects.toThrow('simulated rejection')
      expect(requests).toEqual([`http://127.0.0.1:45678/v1/${id === 'openai' ? 'responses' : 'messages'}`])
    }
  )
  it.each(REASONING_EFFORTS)('sends Responses %s without downgrade or fallback', async (effort) => {
    const request = await capture('openai-response', 'custom-model', effort)
    expect(request.url).toBe('http://127.0.0.1:45678/v1/responses')
    expect(request.body.reasoning.effort).toBe(effort)
  })
  it('defaults missing and removed values to max', async () => {
    for (const effort of [undefined, 'none', 'minimal', 'default', 'auto'])
      expect((await capture('openai-response', 'custom-model', effort)).body.reasoning.effort).toBe('max')
  })
  it.each(REASONING_EFFORTS)('sends native Anthropic %s', async (effort) => {
    const { body } = await capture('anthropic', 'claude-opus-4-7', effort)
    expect(body.output_config.effort).toBe(effort)
    expect(body.thinking.type).toBe('adaptive')
  })
  it.each([
    ['claude-opus-4-6', 'xhigh', 'high'],
    ['claude-opus-4-6', 'max', 'max'],
    ['claude-opus-4-5', 'xhigh', 'high'],
    ['claude-opus-4-5', 'max', 'high']
  ])('maps %s %s to %s', async (id, effort, expected) => {
    const { body } = await capture('anthropic', id, effort)
    expect(body.output_config.effort).toBe(expected)
  })
  it.each(REASONING_EFFORTS)('keeps legacy %s budget below actual output ceiling', async (effort) => {
    const { body } = await capture('anthropic', 'claude-sonnet-4-5', effort)
    expect(body.max_tokens).toBe(8192)
    expect(body.thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
    expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens)
  })
})
