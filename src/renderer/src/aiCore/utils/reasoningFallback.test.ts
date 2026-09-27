import { webcrypto } from 'node:crypto'

import type { Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearReasoningCapabilityCache,
  effortRejection,
  REASONING_CACHE_TTL,
  withReasoningFallback
} from './reasoningFallback'

const provider = {
  id: 'one',
  type: 'openai-response',
  apiHost: 'https://example.invalid/v1',
  apiKey: 'simulation-key'
} as Provider
const params = {
  prompt: 'unchanged',
  providerOptions: { openai: { reasoningEffort: 'max', store: false } }
} as StreamTextParams
const reject = (message = 'Invalid reasoning.effort: max is not supported') =>
  Object.assign(new Error(message), { statusCode: 400 })
const run = (execute: any, changes: Record<string, any> = {}) =>
  withReasoningFallback({
    provider,
    modelId: 'gpt-6-sol',
    params,
    requested: 'max',
    disabled: false,
    execute,
    ...changes
  })
beforeEach(() => {
  clearReasoningCapabilityCache()
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bounded effort negotiation', () => {
  it('selects the highest allowed effort and suppresses rejected terminal chunks', async () => {
    const onChunk = vi.fn(),
      onEffective = vi.fn()
    const execute = vi.fn(async (options, chunk) => {
      if (options.providerOptions.openai.reasoningEffort === 'max') {
        const error = reject(
          "Unsupported reasoning.effort 'max'. Supported values are: 'low', 'medium', 'high', 'xhigh'."
        )
        chunk({ type: ChunkType.ERROR, error })
        throw error
      }
      chunk({ type: ChunkType.TEXT_DELTA, text: 'ok' })
      return 'ok'
    })
    expect(await run(execute, { onChunk, onEffective })).toBe('ok')
    expect(execute.mock.calls.map(([p]) => p.providerOptions.openai.reasoningEffort)).toEqual(['max', 'xhigh'])
    expect(execute.mock.calls.every(([p]) => p.prompt === 'unchanged' && p.maxRetries === 0)).toBe(true)
    expect(onChunk.mock.calls.map(([c]) => c.type)).toEqual([ChunkType.TEXT_DELTA])
    expect(onEffective).toHaveBeenCalledWith('xhigh')
  })
  it('tries each descending effort only once without an allowed list', async () => {
    const execute = vi.fn(async () => {
      throw reject()
    })
    await expect(run(execute)).rejects.toThrow('not supported')
    expect(execute.mock.calls.map(([p]) => p.providerOptions.openai.reasoningEffort)).toEqual([
      'max',
      'xhigh',
      'high',
      'medium',
      'low'
    ])
  })
  it.each([401, 403, 429, 500])('does not retry HTTP %s', async (statusCode) => {
    const execute = vi.fn(async () => {
      throw Object.assign(reject(), { statusCode })
    })
    await expect(run(execute)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it.each([ChunkType.TEXT_DELTA, ChunkType.THINKING_DELTA, ChunkType.TOOL_IN_PROGRESS])(
    'does not replay after %s',
    async (type) => {
      const execute = vi.fn(async (_p, chunk) => {
        chunk({ type, text: 'content' })
        throw reject()
      })
      await expect(run(execute)).rejects.toThrow()
      expect(execute).toHaveBeenCalledTimes(1)
    }
  )
  it('does not downgrade unrelated parameters or disabled model tests', async () => {
    expect(effortRejection(reject('Invalid max_output_tokens; max is unsupported'))).toBeUndefined()
    const execute = vi.fn(async () => {
      throw reject()
    })
    await expect(run(execute, { disabled: true })).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('expires capability cache and invalidates it for credentials, address and model changes', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async (p) => {
      if (p.providerOptions.openai.reasoningEffort !== 'high')
        throw reject("Invalid reasoning.effort. Supported values: ['low', 'high']")
      return 'ok'
    })
    await run(execute)
    expect(execute).toHaveBeenCalledTimes(2)
    await run(execute)
    expect(execute).toHaveBeenCalledTimes(3)
    await run(execute, { provider: { ...provider, apiKey: 'different-key' } })
    expect(execute).toHaveBeenCalledTimes(5)
    await run(execute, { provider: { ...provider, apiHost: 'https://other.invalid' } })
    expect(execute).toHaveBeenCalledTimes(7)
    await run(execute, { modelId: 'other-model' })
    expect(execute).toHaveBeenCalledTimes(9)
    await vi.advanceTimersByTimeAsync(REASONING_CACHE_TTL + 1)
    await run(execute)
    expect(execute).toHaveBeenCalledTimes(11)
  })
  it('never caches an effort from a failed or cancelled request', async () => {
    const controller = new AbortController()
    const execute = vi.fn(async () => {
      controller.abort()
      throw reject()
    })
    await expect(run(execute, { params: { ...params, abortSignal: controller.signal } })).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
