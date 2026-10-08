import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FingerprintCore from './fingerprintCore'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn(), rewriteReport: vi.fn() }))
vi.mock('./directModelTest', () => ({ prepareDirectModelTest: mocks.prepare }))
vi.mock('./fingerprintCore', async (importOriginal) => {
  const actual = await importOriginal<typeof FingerprintCore>()
  return {
    ...actual,
    analyzeGlobalOutputs: (...args: Parameters<typeof actual.analyzeGlobalOutputs>) => {
      const report = actual.analyzeGlobalOutputs(...args)
      const rewrite = mocks.rewriteReport.getMockImplementation()
      return rewrite ? rewrite(report, ...args) : report
    }
  }
})

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

function setProbability(probability: number) {
  mocks.rewriteReport.mockImplementation((report: any) => (report ? { ...report, probability } : report))
}

function deferredVoid() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

interface ControlledAttempt {
  index: number
  settled: boolean
  signal: AbortSignal
  emit: (chunk: Chunk) => void
  complete: (text?: string) => void
  fail: (error: unknown) => void
}

function controlRequests(options: { abortCleanup?: Promise<void> } = {}) {
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
        const onAbort = () => {
          if (options.abortCleanup) {
            void options.abortCleanup.then(() => settle(() => reject(signal.reason)))
          } else {
            settle(() => reject(signal.reason))
          }
        }
        attempts.push({
          index: Number(prompt.slice(-1)),
          get settled() {
            return settled
          },
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
      if (!attempt) throw new Error(`group ${index}, attempt ${ordinal} should have started`)
      return attempt
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
  mocks.rewriteReport
    .mockReset()
    .mockImplementation((report: any) => (report ? { ...report, probability: 0.5 } : report))
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
  ])(
    'runs group zero alone, then fills at most two remaining slots for the $label limit',
    async ({ concurrency, limit }) => {
      const requests = controlRequests()
      const pending = start(createRunner({ concurrency }))
      await flush()
      expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
      expect(requests.active).toBe(1)
      requests.attempt(0).complete(textFor(0))
      await flush()
      const remainingLimit = Math.min(limit, 2)
      expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2].slice(0, remainingLimit + 1))
      expect(requests.active).toBe(remainingLimit)
      for (let index = 1; index < 3; index += 1) {
        requests.attempt(index).complete(textFor(index))
        await flush()
        expect(requests.active).toBe(Math.min(remainingLimit, 2 - index))
      }
      const result = await pending
      expect(requests.peak).toBe(Math.max(1, remainingLimit))
      expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'completed', 'completed'])
      expect(result.outputs.map((output) => output.attempts)).toEqual([1, 1, 1])
      expect(result.report?.used_outputs).toBe(3)
      expect(result.completionReason).toBe('samples-finished')
    }
  )

  it('isolates interleaved remaining-group deltas and keeps original indices when they finish out of order', async () => {
    const requests = controlRequests()
    const progress = vi.fn()
    const pending = start(createRunner({ concurrency: 3, onProgress: progress }))
    await flush()
    const texts = [0, 1, 2].map(textFor)
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
    requests.attempt(0).emit({ type: ChunkType.TEXT_START })
    for (let offset = 0; offset < texts[0].length; offset += 17) {
      requests.attempt(0).emit({ type: ChunkType.TEXT_DELTA, text: texts[0].slice(offset, offset + 17) })
    }
    requests.attempt(0).complete()
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    for (const index of [1, 2]) requests.attempt(index).emit({ type: ChunkType.TEXT_START })
    for (let offset = 0; offset < Math.max(...texts.map((text) => text.length)); offset += 17) {
      for (const index of [2, 1]) {
        requests.attempt(index).emit({ type: ChunkType.TEXT_DELTA, text: texts[index].slice(offset, offset + 17) })
      }
    }
    for (const index of [2, 1]) {
      requests.attempt(index).complete()
      await flush()
    }
    const result = await pending
    expect(result.outputs.map((output) => output.id)).toEqual(challenges.map((challenge) => challenge.id))
    expect(result.outputs.map((output) => output.text)).toEqual(texts)
    expect(result.outputs.map((output) => output.parsedCount)).toEqual([303, 304, 305])
    expect(
      progress.mock.calls.filter(([event]) => event.output.status === 'completed').map(([event]) => event.index)
    ).toEqual([0, 2, 1])
    for (const [event] of progress.mock.calls) {
      expect(event.challenge.id).toBe(challenges[event.index].id)
      expect(event.output.id).toBe(challenges[event.index].id)
    }
    expect(result.report?.used_outputs).toBe(3)
  })

  it('finishes the first group retry before starting the remaining serial groups', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 1 }))
    await flush()
    requests.attempt(0).fail(new TypeError('connection reset'))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0])
    expect(requests.active).toBe(1)
    requests.attempt(0, 2).complete(textFor(0))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0, 1])
    requests.attempt(1).complete(textFor(1))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0, 1, 2])
    requests.attempt(2).complete(textFor(2))
    const result = await pending
    expect(requests.peak).toBe(1)
    expect(result.outputs.map((output) => output.attempts)).toEqual([2, 1, 1])
    expect(result.report?.used_outputs).toBe(3)
  })

  it.each([
    { probability: 0.989999, completionReason: 'samples-finished', stopsAfterFirst: false },
    { probability: 0.99, completionReason: 'confidence-reached', stopsAfterFirst: true }
  ] as const)(
    'uses the unrounded $probability threshold after the first group',
    async ({ probability, completionReason, stopsAfterFirst }) => {
      setProbability(probability)
      const requests = controlRequests()
      const runner = createRunner({ concurrency: 3 })
      const pending = start(runner)
      await flush()
      requests.attempt(0).complete(textFor(0))
      await flush()

      if (stopsAfterFirst) {
        const result = await pending
        expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
        expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'skipped', 'skipped'])
        expect(result.report).toMatchObject({ probability, used_outputs: 1 })
        expect(result.completionReason).toBe(completionReason)
        const retry = await runner.run({ retryFailedOnly: true })
        expect(retry.outputs).toEqual(result.outputs)
        expect(mocks.execute).toHaveBeenCalledTimes(1)
      } else {
        expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
        requests.attempt(1).complete(textFor(1))
        requests.attempt(2).complete(textFor(2))
        const result = await pending
        expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'completed', 'completed'])
        expect(result.report).toMatchObject({ probability, used_outputs: 3 })
        expect(result.completionReason).toBe(completionReason)
      }
    }
  )

  it('does not stop on the first group when its completed answer has too few usable samples', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    requests.attempt(0).complete('247 '.repeat(20))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    expect(requests.attempt(0).signal.aborted).toBe(false)
    requests.attempt(1).complete(textFor(1))
    requests.attempt(2).complete(textFor(2))
    const result = await pending
    expect(result.outputs[0]).toMatchObject({ status: 'completed', usableCount: 20, issue: 'insufficient' })
    expect(result.report?.used_outputs).toBe(2)
    expect(result.completionReason).toBe('samples-finished')
  })

  it('continues to later groups after the first group exhausts its retries', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      requests.attempt(0, ordinal).fail(new TypeError('connection reset'))
      await flush()
      if (ordinal < 3) {
        const delay = ordinal === 1 ? 1000 : 3000
        await vi.advanceTimersByTimeAsync(delay)
      }
    }
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0, 0, 1, 2])
    requests.attempt(1).complete(textFor(1))
    requests.attempt(2).complete(textFor(2))
    const result = await pending
    expect(result.outputs[0]).toMatchObject({ status: 'error', attempts: 3, retryStopReason: 'exhausted' })
    expect(result.outputs.slice(1).map((output) => output.status)).toEqual(['completed', 'completed'])
    expect(result.report?.used_outputs).toBe(2)
    expect(result.completionReason).toBe('samples-finished')
  })

  it('does not retry providers when local attribution throws', async () => {
    mocks.rewriteReport.mockImplementation(() => {
      throw new Error('local attribution failure')
    })
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    requests.attempt(0).complete(textFor(0))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    requests.attempt(1).complete(textFor(1))
    requests.attempt(2).complete(textFor(2))
    const result = await pending
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'completed', 'completed'])
    expect(result.error).toBeUndefined()
    expect(result.report).toBeUndefined()
    expect(result.completionReason).toBe('samples-finished')
  })

  it('reaches confidence after group one, ignores late chunks and waits for peer cleanup', async () => {
    setProbability(0.5)
    const cleanup = deferredVoid()
    const requests = controlRequests({ abortCleanup: cleanup.promise })
    const progress = vi.fn()
    const pending = start(createRunner({ concurrency: 3, onProgress: progress }))
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await flush()
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      requests.attempt(0, ordinal).fail(new TypeError('connection reset'))
      await flush()
      if (ordinal < 3) await vi.advanceTimersByTimeAsync(ordinal === 1 ? 1000 : 3000)
    }
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0, 0, 1, 2])

    setProbability(0.99)
    requests.attempt(1).complete(textFor(1))
    await flush()
    expect(requests.attempt(2).signal.aborted).toBe(true)
    expect(requests.active).toBe(1)
    expect(settled).toBe(false)
    const progressCount = progress.mock.calls.length
    requests.attempt(2).emit({ type: ChunkType.TEXT_DELTA, text: 'late answer chunk' })
    expect(progress).toHaveBeenCalledTimes(progressCount)
    expect(settled).toBe(false)

    cleanup.resolve()
    await flush()
    const result = await pending
    expect(requests.active).toBe(0)
    expect(result.outputs.map((output) => output.status)).toEqual(['skipped', 'completed', 'skipped'])
    expect(result.outputs[0]).toMatchObject({ text: '', error: undefined, retryable: false })
    expect(result.outputs[2].text).toBe('')
    expect(result.report).toMatchObject({ probability: 0.99, used_outputs: 1 })
    expect(result.completionReason).toBe('confidence-reached')
  })

  it.each([1, 2, 3] as const)(
    'caps concurrency %i at nine requests with one- and three-second retry delays',
    async (concurrency) => {
      const requests = controlRequests()
      const progress = vi.fn()
      const pending = start(createRunner({ concurrency, onProgress: progress }))
      await flush()
      while (requests.attempts.length < 9 || requests.attempts.some((attempt) => !attempt.settled)) {
        const activeAttempt = requests.attempts.find((attempt) => !attempt.settled)
        if (activeAttempt) {
          activeAttempt.fail(new TypeError('connection reset'))
          await flush()
          continue
        }
        expect(vi.getTimerCount()).toBeGreaterThan(0)
        const before = requests.attempts.length
        await vi.advanceTimersByTimeAsync(1000)
        if (requests.attempts.length === before && vi.getTimerCount() > 0) {
          await vi.advanceTimersByTimeAsync(2000)
        }
        await flush()
      }
      const result = await pending
      expect(requests.attempts).toHaveLength(9)
      expect(requests.peak).toBe(Math.min(concurrency, 2))
      expect(result.outputs.every((output) => output.status === 'error' && output.attempts === 3)).toBe(true)
      expect(result.outputs.every((output) => output.retryStopReason === 'exhausted')).toBe(true)
      expect(result.report).toBeUndefined()
      const retryDelays = progress.mock.calls
        .filter(([event]) => event.output.status === 'retrying')
        .map(([event]) => event.output.retryDelayMs)
      expect(retryDelays).toHaveLength(6)
      expect(retryDelays.filter((delay) => delay === 1000)).toHaveLength(3)
      expect(retryDelays.filter((delay) => delay === 3000)).toHaveLength(3)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('retries an output-limited group with a fresh collector while preserving the other groups', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 3 }))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
    const failed = requests.attempt(0)
    failed.emit({ type: ChunkType.TEXT_DELTA, text: '355 '.repeat(607) })
    await flush()
    expect(failed.signal.aborted).toBe(true)
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
    await vi.advanceTimersByTimeAsync(1000)
    failed.complete('stale response')
    requests.attempt(0, 2).complete(textFor(0))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0, 1, 2])
    for (const index of [1, 2]) requests.attempt(index).complete(textFor(index))
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
    requests.attempt(0).complete(textFor(0))
    await flush()
    const laterAttempts = requests.attempts.filter((attempt) => attempt.index !== 0)
    expect(laterAttempts.map((attempt) => attempt.index)).toEqual([1, 2].slice(0, Math.min(concurrency, 2)))
    runner.cancel()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(laterAttempts.every((attempt) => attempt.signal.aborted)).toBe(true)
    expect(requests.active).toBe(0)
    expect(
      progress.mock.calls.filter(([event]) => event.output.status === 'aborted').map(([event]) => event.index)
    ).toEqual([1, 2])
    const count = progress.mock.calls.length
    laterAttempts.forEach((attempt) => attempt.complete('late output'))
    await vi.runAllTimersAsync()
    expect(progress).toHaveBeenCalledTimes(count)
    expect(mocks.execute).toHaveBeenCalledTimes(1 + Math.min(concurrency, 2))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a retry timer before it can send the first group again or queue later groups', async () => {
    const requests = controlRequests()
    const progress = vi.fn()
    const runner = createRunner({ concurrency: 3, onProgress: progress })
    const pending = start(runner)
    await flush()
    requests.attempt(0).fail(new TypeError('connection reset'))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0])
    expect(vi.getTimerCount()).toBeGreaterThan(0)
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
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
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
    expect(previousAttempts.map((attempt) => attempt.index)).toEqual([0])
    const current = start(runner)
    await expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    const count = progress.mock.calls.length
    for (const attempt of previousAttempts) {
      attempt.complete('stale completed answer')
      attempt.emit({ type: ChunkType.ERROR, error: new Error('stale failure') })
    }
    expect(progress).toHaveBeenCalledTimes(count)
    requests.attempt(0, 2).complete(textFor(0))
    await flush()
    requests.attempt(1).complete(textFor(1))
    requests.attempt(2).complete(textFor(2))
    const result = await current
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    expect(result.outputs.map((output) => output.text)).toEqual([0, 1, 2].map(textFor))
    expect(result.outputs.map((output) => output.attempts)).toEqual([1, 1, 1])
    expect(result.error).toBeUndefined()
    expect(result.report?.used_outputs).toBe(3)
    expect(result.completionReason).toBe('samples-finished')
  })

  it('rejects a superseded run after delayed cleanup when its replacement reaches confidence', async () => {
    const cleanup = deferredVoid()
    const requests = controlRequests({ abortCleanup: cleanup.promise })
    const progress = vi.fn()
    const runner = createRunner({ concurrency: 3, onProgress: progress })
    const previous = start(runner)
    await flush()
    const oldAttempt = requests.attempt(0)
    const current = start(runner)
    expect(oldAttempt.signal.aborted).toBe(true)
    expect(oldAttempt.settled).toBe(false)
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 0])

    setProbability(0.99)
    requests.attempt(0, 2).complete(textFor(0))
    await flush()
    const result = await current
    expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'skipped', 'skipped'])
    expect(result.report).toMatchObject({ probability: 0.99, used_outputs: 1 })
    expect(result.completionReason).toBe('confidence-reached')
    expect(oldAttempt.settled).toBe(false)

    const progressCount = progress.mock.calls.length
    oldAttempt.emit({ type: ChunkType.TEXT_DELTA, text: 'late old-run answer' })
    oldAttempt.emit({ type: ChunkType.ERROR, error: new Error('late old-run failure') })
    expect(progress).toHaveBeenCalledTimes(progressCount)

    cleanup.resolve()
    await flush()
    await expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests.active).toBe(0)
    expect(progress).toHaveBeenCalledTimes(progressCount)
    const retained = await runner.run({ retryFailedOnly: true })
    expect(retained.outputs).toEqual(result.outputs)
    expect(retained.report).toEqual(result.report)
    expect(retained.completionReason).toBe(result.completionReason)
    expect(mocks.execute).toHaveBeenCalledTimes(2)
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
    expect(result.outputs.map((output) => output.attempts)).toEqual([1, 0, 0])
    expect(result.outputs.every((output) => output.retryStopReason === category)).toBe(true)
    expect(result.outputs[0]).toMatchObject({ retryable: false, failureCategory: category })
    expect(requests.active).toBe(0)
    const count = progress.mock.calls.length
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledTimes(count)
    expect(result.report).toBeUndefined()
    expect(result.completionReason).toBe('fatal-error')
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
    expect(result.completionReason).toBe('fatal-error')
    expect(mocks.execute).toHaveBeenCalledTimes(3)
  })

  it('a fatal error also clears a different group waiting to retry', async () => {
    const requests = controlRequests()
    const pending = start(createRunner({ concurrency: 2 }))
    await flush()
    requests.attempt(0).complete(textFor(0))
    await flush()
    expect(requests.attempts.map((attempt) => attempt.index)).toEqual([0, 1, 2])
    requests.attempt(1).fail(new TypeError('connection reset'))
    await flush()
    expect(requests.attempt(1).signal.aborted).toBe(true)
    requests.attempt(2).fail(new Error('insufficient_quota'))
    const result = await pending
    expect(result.outputs.map((output) => output.status)).toEqual(['completed', 'aborted', 'error'])
    expect(result.outputs.slice(1).every((output) => output.retryStopReason === 'quota')).toBe(true)
    expect(result.outputs[0].retryDelayMs).toBeUndefined()
    expect(requests.attempt(1).signal.aborted).toBe(true)
    await vi.runAllTimersAsync()
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    expect(result.completionReason).toBe('fatal-error')
  })
})
