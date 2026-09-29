import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn() }))
vi.mock('./directModelTest', () => ({ prepareDirectModelTest: mocks.prepare }))

import { ModelTestRunner, type ModelTestRunnerConfig } from './ModelTraceService'

const model: Model = { id: 'gpt-6-sol', name: 'friendly name', provider: 'happy', group: '' }
const challenges = [0, 1, 2].map((index) => ({
  id: `probe-${index}`,
  expected_count: 303 + index,
  prompt: `unchanged-${index}`
}))
const textFor = (index: number) =>
  Array.from({ length: challenges[index].expected_count }, (_, offset) =>
    String(((offset * 29 + index * 113) % 355) + 1)
  ).join(' ')
const flush = () => vi.advanceTimersByTimeAsync(0)
let runners: ModelTestRunner[] = []

function createRunner(config: Omit<ModelTestRunnerConfig, 'model' | 'challenges'> = {}) {
  const runner = new ModelTestRunner({ model, challenges, ...config })
  runners.push(runner)
  return runner
}

function start(runner: ModelTestRunner) {
  const pending = runner.run()
  // Failed assertions must not leave an unobserved cancellation rejection in cleanup.
  void pending.catch(() => undefined)
  return pending
}

interface ControlledAttempt {
  index: number
  signal: AbortSignal
  emit: (chunk: Chunk) => void
  complete: (text?: string) => void
  fail: (error: unknown) => void
}

function controlRequests() {
  const attempts: ControlledAttempt[] = []
  let active = 0
  let peak = 0
  mocks.execute.mockImplementation(
    (prompt: string, signal: AbortSignal, emit: (chunk: Chunk) => void) =>
      new Promise<void>((resolve, reject) => {
        active += 1
        peak = Math.max(peak, active)
        let settled = false
        const settle = (action: () => void) => {
          if (settled) return
          settled = true
          active -= 1
          signal.removeEventListener('abort', onAbort)
          action()
        }
        const onAbort = () => settle(() => reject(signal.reason))
        attempts.push({
          index: Number(prompt.slice(-1)),
          signal,
          emit,
          complete: (text) => {
            if (text !== undefined) {
              emit({ type: ChunkType.TEXT_START })
              emit({ type: ChunkType.TEXT_DELTA, text })
              emit({ type: ChunkType.TEXT_COMPLETE, text })
            }
            // No final snapshot: the answer must come from this attempt's collector.
            emit({ type: ChunkType.LLM_RESPONSE_COMPLETE, finishReason: 'stop' })
            settle(resolve)
          },
          fail: (error) => settle(() => reject(error))
        })
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
  )
  return {
    attempts,
    attempt(index: number, ordinal = 1) {
      const attempt = attempts.filter((entry) => entry.index === index)[ordinal - 1]
      expect(attempt, `group ${index}, attempt ${ordinal} should have started`).toBeDefined()
      return attempt!
    },
    get active() {
      return active
    },
    get peak() {
      return peak
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  runners = []
  mocks.execute.mockReset()
  mocks.prepare.mockReset().mockResolvedValue({
    target: { providerId: 'happy', providerName: 'Happy Code', modelId: 'gpt-6-sol' },
    execute: mocks.execute
  })
})

afterEach(async () => {
  runners.forEach((runner) => runner.cancel())
  await vi.runAllTimersAsync()
  vi.useRealTimers()
})

describe('ModelTrace request concurrency', () => {
  it.each([
    { label: 'default', concurrency: undefined, limit: 1 },
    { label: 'one', concurrency: 1 as const, limit: 1 },
    { label: 'two', concurrency: 2 as const, limit: 2 },
    { label: 'three', concurrency: 3 as const, limit: 3 }
  ])('fills but never exceeds the $label request limit', async ({ concurrency, limit }) => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency }))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2].slice(0, limit))
    expect(requests.active).toBe(limit)
    for (let index = 0; index < 3; index += 1) {
      requests.attempt(index).complete(textFor(index))
      await flush()
      expect(requests.active).toBe(Math.min(limit, 2 - index))
    }
    const result = await pending
    expect(requests.peak).toBe(limit)
    expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'completed', 'completed'])
    expect(result.outputs.map((output) => output.attempts)).toEqual([1, 1, 1])
    expect(result.report?.used_outputs).toBe(3)
  })

  it('isolates interleaved deltas and keeps original indices when groups finish out of order', async () => {
    const requests = controlRequests()
    const progress = vi.fn()
    const pending = start(createRunner({ concurrency: 3, onProgress: progress }))
    await flush()
    const texts = [0, 1, 2].map(textFor)
    for (const index of [0, 1, 2]) requests.attempt(index).emit({ type: ChunkType.TEXT_START })
    for (let offset = 0; offset < Math.max(...texts.map((text) => text.length)); offset += 17) {
      for (const index of [2, 0, 1]) {
        requests.attempt(index).emit({ type: ChunkType.TEXT_DELTA, text: texts[index].slice(offset, offset + 17) })
      }
    }
    for (const index of [2, 0, 1]) {
      requests.attempt(index).complete()
      await flush()
    }
    const result = await pending
    expect(result.outputs.map((output) => output.id)).toEqual(challenges.map((challenge) => challenge.id))
    expect(result.outputs.map((output) => output.text)).toEqual(texts)
    expect(result.outputs.map((output) => output.parsedCount)).toEqual([303, 304, 305])
    expect(
      progress.mock.calls.filter(([event]) => event.output.status === 'completed').map(([event]) => event.index)
    ).toEqual([2, 0, 1])
    for (const [event] of progress.mock.calls) {
      expect(event.challenge.id).toBe(challenges[event.index].id)
      expect(event.output.id).toBe(challenges[event.index].id)
    }
    expect(result.report?.used_outputs).toBe(3)
  })

  it('releases a retrying request slot and waits for a free slot after the retry delay', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 1 }))
    await flush()
    requests.attempt(0).fail(new TypeError('connection reset'))
    await flush()
    requests.attempt(1).complete(textFor(1))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests.attempts).toHaveLength(3)
    expect(requests.active).toBe(1)
    requests.attempt(2).complete(textFor(2))
    await flush()
    requests.attempt(0, 2).complete(textFor(0))
    const result = await pending
    expect(requests.peak).toBe(1)
    expect(result.outputs.map((output) => output.attempts)).toEqual([2, 1, 1])
    expect(result.report?.used_outputs).toBe(3)
  })

  it.each([1, 2, 3] as const)(
    'caps concurrency %i at nine requests with one- and three-second retry delays',
    async (concurrency) => {
      const requests = controlRequests()
      const progress = vi.fn()
      const pending = start(createRunner({ concurrency, onProgress: progress }))
      await flush()
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        for (const index of [0, 1, 2]) {
          requests.attempt(index, ordinal).fail(new TypeError('connection reset'))
          await flush()
        }
        expect(requests.active).toBe(0)
        expect(requests.attempts).toHaveLength(ordinal * 3)
        if (ordinal < 3) {
          const delay = ordinal === 1 ? 1000 : 3000
          await vi.advanceTimersByTimeAsync(delay - 1)
          expect(requests.attempts).toHaveLength(ordinal * 3)
          await vi.advanceTimersByTimeAsync(1)
          expect(requests.active).toBe(concurrency)
        }
      }
      const result = await pending
      expect(requests.peak).toBe(concurrency)
      expect(result.outputs.every((output) => output.status === 'error' && output.attempts === 3)).toBe(true)
      expect(result.outputs.every((output) => output.retryStopReason === 'exhausted')).toBe(true)
      expect(result.report).toBeUndefined()
      expect(
        progress.mock.calls
          .filter(([event]) => event.output.status === 'retrying')
          .map(([event]) => event.output.retryDelayMs)
      ).toEqual([1000, 1000, 1000, 3000, 3000, 3000])
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('retries an output-limited group with a fresh collector while preserving the other groups', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    const failed = requests.attempt(0)
    failed.emit({ type: ChunkType.TEXT_DELTA, text: '355 '.repeat(607) })
    await flush()
    expect(failed.signal.aborted).toBe(true)
    for (const index of [1, 2]) {
      expect(requests.attempt(index).signal.aborted).toBe(false)
      requests.attempt(index).complete(textFor(index))
    }
    await vi.advanceTimersByTimeAsync(1000)
    failed.complete('stale response')
    requests.attempt(0, 2).complete(textFor(0))
    const result = await pending
    expect(result.outputs.map((output) => output.text)).toEqual([0, 1, 2].map(textFor))
    expect(result.outputs.map((output) => output.attempts)).toEqual([2, 1, 1])
    expect(result.report?.used_outputs).toBe(3)
  })
})

describe('ModelTrace concurrent cancellation', () => {
  it.each([1, 2, 3] as const)('stops every active and queued group at concurrency %i', async (concurrency) => {
    const requests = controlRequests()
    const progress = vi.fn()
    const runner = createRunner({ concurrency, onProgress: progress })
    const pending = start(runner)
    await flush()
    runner.cancel()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests.attempts.every((attempt) => attempt.signal.aborted)).toBe(true)
    expect(requests.active).toBe(0)
    expect(
      progress.mock.calls.filter(([event]) => event.output.status === 'aborted').map(([event]) => event.index)
    ).toEqual([0, 1, 2])
    const count = progress.mock.calls.length
    requests.attempts.forEach((attempt) => attempt.complete('late output'))
    await vi.runAllTimersAsync()
    expect(progress).toHaveBeenCalledTimes(count)
    expect(mocks.execute).toHaveBeenCalledTimes(concurrency)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels retry waits, active work and queued work together', async () => {
    const requests = controlRequests()
    const progress = vi.fn()
    const runner = createRunner({ concurrency: 1, onProgress: progress })
    const pending = start(runner)
    await flush()
    requests.attempt(0).fail(new TypeError('connection reset'))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1])
    runner.cancel()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const aborted = progress.mock.calls
      .filter(([event]) => event.output.status === 'aborted')
      .map(([event]) => event.output)
    expect(aborted).toHaveLength(3)
    expect(aborted.every((output) => output.retryStopReason === 'cancelled' && output.retryDelayMs === undefined)).toBe(
      true
    )
    const count = progress.mock.calls.length
    requests.attempts.forEach((attempt) => attempt.complete('late retry output'))
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores old-session events after the same runner starts again', async () => {
    const requests = controlRequests()
    const progress = vi.fn()
    const runner = createRunner({ concurrency: 3, onProgress: progress })
    const previous = start(runner)
    await flush()
    const previousAttempts = [...requests.attempts]
    const current = start(runner)
    await expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    const count = progress.mock.calls.length
    for (const attempt of previousAttempts) {
      attempt.complete('stale completed answer')
      attempt.emit({ type: ChunkType.ERROR, error: new Error('stale failure') })
    }
    expect(progress).toHaveBeenCalledTimes(count)
    for (const index of [0, 1, 2]) requests.attempt(index, 2).complete(textFor(index))
    const result = await current
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(result.outputs.map((output) => output.text)).toEqual([0, 1, 2].map(textFor))
    expect(result.outputs.map((output) => output.attempts)).toEqual([1, 1, 1])
    expect(result.error).toBeUndefined()
    expect(result.report?.used_outputs).toBe(3)
  })

  it.each([
    { category: 'auth', error: Object.assign(new Error('Unauthorized'), { statusCode: 401 }) },
    { category: 'quota', error: Object.assign(new Error('insufficient_quota'), { statusCode: 429 }) },
    { category: 'model', error: new Error('model_not_found') },
    { category: 'invalid-request', error: new Error('invalid_request') }
  ])('a fatal $category error cancels in-flight and queued groups without retries', async ({ category, error }) => {
    const requests = controlRequests()
    const progress = vi.fn()
    const pending = start(createRunner({ concurrency: 2, onProgress: progress }))
    await flush()
    requests.attempt(0).fail(error)
    const result = await pending
    expect(result.error).toBe(error.message)
    expect(result.outputs.map((output) => output.status)).toEqual(['error', 'aborted', 'aborted'])
    expect(result.outputs.map((output) => output.attempts)).toEqual([1, 1, 0])
    expect(result.outputs.every((output) => output.retryStopReason === category)).toBe(true)
    expect(result.outputs[0]).toMatchObject({ retryable: false, failureCategory: category })
    expect(requests.attempt(1).signal.aborted).toBe(true)
    expect(requests.active).toBe(0)
    const count = progress.mock.calls.length
    requests.attempt(1).complete(textFor(1))
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledTimes(count)
    expect(result.report).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves completed answers when a streamed fatal error aborts other requests', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    requests.attempt(0).complete(textFor(0))
    await flush()
    requests.attempt(1).emit({ type: ChunkType.ERROR, error: new Error('invalid_api_key') })
    const result = await pending
    expect(result.error).toBe('invalid_api_key')
    expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'error', 'aborted'])
    expect(result.outputs[0]).toMatchObject({ text: textFor(0), attempts: 1 })
    expect(result.outputs[2].retryStopReason).toBe('auth')
    expect(requests.attempt(2).signal.aborted).toBe(true)
    expect(result.report?.used_outputs).toBe(1)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
  })

  it('a fatal error also clears a different group waiting to retry', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 2 }))
    await flush()
    requests.attempt(0).fail(new TypeError('connection reset'))
    await flush()
    requests.attempt(2)
    requests.attempt(1).fail(new Error('insufficient_quota'))
    const result = await pending
    expect(result.outputs.map((output) => output.status)).toEqual(['aborted', 'error', 'aborted'])
    expect(result.outputs.every((output) => output.retryStopReason === 'quota')).toBe(true)
    expect(result.outputs[0].retryDelayMs).toBeUndefined()
    expect(requests.attempt(2).signal.aborted).toBe(true)
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })
})
