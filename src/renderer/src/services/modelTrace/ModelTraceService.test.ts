import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn() }))
vi.mock('./directModelTest', () => ({ prepareDirectModelTest: mocks.prepare }))

import { analyzeModelTraceOutputs, isRetryableModelTestError, ModelTestRunner } from './ModelTraceService'

const model: Model = { id: 'gpt-6-sol', name: 'friendly name', provider: 'happy', group: '' }
const challenges = [0, 1, 2].map((i) => ({ id: `probe-${i}`, expected_count: 303 + i, prompt: `unchanged-${i}` }))
const textFor = (index: number) => Array.from({ length: 303 + index }, (_, i) => String((i % 355) + 1)).join(' ')
const emit = (onChunk: (chunk: Chunk) => void, text: string) => {
  onChunk({ type: ChunkType.TEXT_START })
  for (const delta of text.match(/.{1,17}/g) || []) onChunk({ type: ChunkType.TEXT_DELTA, text: delta })
  onChunk({ type: ChunkType.TEXT_COMPLETE, text })
  onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text } })
}
const success = async (prompt: string, _signal: AbortSignal, onChunk: (chunk: Chunk) => void) => {
  emit(onChunk, textFor(Number(prompt.slice(-1))))
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.execute.mockReset().mockImplementation(success)
  mocks.prepare.mockReset().mockResolvedValue({
    target: { providerId: 'happy', providerName: 'Happy Code', modelId: 'gpt-6-sol' },
    execute: mocks.execute
  })
})
afterEach(() => vi.useRealTimers())

describe('bounded ModelTrace sessions', () => {
  it('retries only the invalid challenge, with the exact same prompt and frozen model', async () => {
    const selected = { ...model }
    const probes = challenges.map((challenge) => ({ ...challenge }))
    const runner = new ModelTestRunner({ model: selected, challenges: probes })
    selected.id = 'different-model'
    probes[0].prompt = 'changed'
    mocks.execute.mockImplementationOnce(async (_prompt, _signal, onChunk) => emit(onChunk, 'Need 303 numbers. 1 2 3'))
    const pending = runner.run()
    await vi.runAllTimersAsync()
    const result = await pending
    expect(mocks.prepare.mock.calls[0][0].id).toBe('gpt-6-sol')
    expect(mocks.execute.mock.calls.map(([prompt]) => prompt)).toEqual([
      'unchanged-0',
      'unchanged-0',
      'unchanged-1',
      'unchanged-2'
    ])
    expect(result.outputs.map((output) => output.attempts)).toEqual([2, 1, 1])
    expect(result.outputs[0].text).toBe(textFor(0))
    expect(result.report?.used_outputs).toBe(3)
    expect(analyzeModelTraceOutputs(result.outputs)).toEqual(result.report)
  })

  it('caps each group at 3 requests, keeps successes and retries only failed groups', async () => {
    const runner = new ModelTestRunner({ model, challenges })
    mocks.execute.mockImplementation(async (prompt, signal, onChunk) => {
      if (prompt === 'unchanged-0') emit(onChunk, '1 2 3')
      else await success(prompt, signal, onChunk)
    })
    const pending = runner.run()
    await vi.runAllTimersAsync()
    const failed = await pending
    expect(mocks.execute).toHaveBeenCalledTimes(5)
    expect(failed.outputs.map((output) => output.status)).toEqual(['invalid', 'valid', 'valid'])
    expect(failed.report).toBeUndefined()
    mocks.execute.mockImplementation(success)
    const result = await runner.run({ retryFailedOnly: true })
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(result.report?.used_outputs).toBe(3)
  })

  it('never exceeds nine requests or produces a report if every answer is invalid', async () => {
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, ''))
    const pending = new ModelTestRunner({ model, challenges }).run()
    await vi.runAllTimersAsync()
    const result = await pending
    expect(mocks.execute).toHaveBeenCalledTimes(9)
    expect(result.report).toBeUndefined()
  })

  it('stops immediately on authentication failure', async () => {
    mocks.execute.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    const result = await new ModelTestRunner({ model, challenges }).run()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(result.error).toBe('Unauthorized')
  })

  it('cancels a pending retry and ignores late callbacks', async () => {
    const progress = vi.fn()
    let late: (chunk: Chunk) => void = () => {}
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => {
      late = onChunk
      emit(onChunk, '1')
    })
    const runner = new ModelTestRunner({ model, challenges, onProgress: progress })
    const pending = runner.run().catch((error) => error)
    await vi.advanceTimersByTimeAsync(0)
    runner.cancel()
    const count = progress.mock.calls.length
    late({ type: ChunkType.TEXT_DELTA, text: 'late data' })
    await vi.runAllTimersAsync()
    expect((await pending).name).toBe('AbortError')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledTimes(count)
  })

  it('allows long waits without a request timeout and aborts an active attempt', async () => {
    mocks.execute.mockImplementation(
      (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const runner = new ModelTestRunner({ model, challenges })
    const pending = runner.run().catch((error) => error)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    runner.cancel()
    expect((await pending).name).toBe('AbortError')
  })

  it('discards errors and partial text before retrying a disconnected stream', async () => {
    mocks.execute.mockImplementationOnce(async (_prompt, _signal, onChunk) => {
      onChunk({ type: ChunkType.TEXT_DELTA, text: '17 23 ' })
      throw new TypeError('connection reset')
    })
    const pending = new ModelTestRunner({ model, challenges }).run()
    await vi.runAllTimersAsync()
    expect((await pending).outputs[0].text).toBe(textFor(0))
  })
})

describe('retry classification', () => {
  it.each([408, 429, 500, 502, 503])('retries HTTP %i', (statusCode) => {
    expect(isRetryableModelTestError({ statusCode })).toBe(true)
  })
  it.each([400, 401, 403, 404, 422])('does not retry HTTP %i', (statusCode) => {
    expect(isRetryableModelTestError({ statusCode })).toBe(false)
  })
  it('preserves wrapped errors and never retries cancellation', () => {
    expect(isRetryableModelTestError(new Error('upstream error', { cause: { statusCode: 503 } }))).toBe(true)
    expect(isRetryableModelTestError(new Error('upstream error', { cause: new Error('ECONNRESET') }))).toBe(true)
    expect(isRetryableModelTestError(new DOMException('network aborted', 'AbortError'))).toBe(false)
    expect(isRetryableModelTestError(new Error('invalid model'))).toBe(false)
  })
})
