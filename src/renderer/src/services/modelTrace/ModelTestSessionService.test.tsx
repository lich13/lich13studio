// @vitest-environment jsdom
import { useModelTestSession } from '@renderer/hooks/useModelTestSession'
import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FingerprintCore from './fingerprintCore'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn(), rewriteReport: vi.fn(), acquire: vi.fn() }))
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
vi.mock('@renderer/services/mobile/BackgroundTaskService', () => ({ backgroundTasks: { acquire: mocks.acquire } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))

import { bundledBankSnapshot } from './fingerprintBank'
import type { FingerprintBankService } from './FingerprintBankService'
import { modelTestSession, ModelTestSessionService } from './ModelTestSessionService'

const model: Model = { id: 'gpt-6-sol', provider: 'one', name: 'Sol', group: '' }
const emit = (onChunk: (chunk: Chunk) => void, count: number) => {
  const text = Array(count).fill('247').join(' ')
  onChunk({ type: ChunkType.TEXT_START })
  onChunk({ type: ChunkType.TEXT_DELTA, text })
  onChunk({ type: ChunkType.TEXT_COMPLETE, text })
  onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text } })
}
const setProbability = (probability: number) => {
  mocks.rewriteReport.mockImplementation((report: any) => (report ? { ...report, probability } : report))
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.execute.mockReset()
  mocks.rewriteReport
    .mockReset()
    .mockImplementation((report: any) => (report ? { ...report, probability: 0.5 } : report))
  mocks.acquire.mockReset().mockImplementation(async () => vi.fn())
  mocks.prepare.mockReset().mockResolvedValue({
    target: { providerId: 'one', providerName: 'One', modelId: 'gpt-6-sol' },
    execute: mocks.execute
  })
})
afterEach(() => {
  modelTestSession.stop()
  modelTestSession.regenerate()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('route-independent model-test sessions', () => {
  it('freezes concurrency and bank through updates and failed-group retries, then uses the new bank for a new run', async () => {
    let bank = structuredClone(bundledBankSnapshot)
    const originalRevision = bank.version.revision
    const banks = { capture: () => bank } as FingerprintBankService
    const service = new ModelTestSessionService(banks)
    const challenges = service.getSnapshot().challenges
    let fail = true
    mocks.execute.mockImplementation(async (prompt, _signal, onChunk) => {
      if (fail && prompt === challenges[0].prompt) throw new TypeError('connection reset')
      emit(onChunk, 80)
    })
    const run = service.start(model, 3)
    bank = structuredClone(bundledBankSnapshot)
    bank.version.revision = 'f'.repeat(40)
    bank.bank.calibration['1'].beta = 3
    await vi.runAllTimersAsync()
    await run
    expect(service.getSnapshot()).toMatchObject({ concurrency: 3, bankVersion: { revision: originalRevision } })
    expect(service.getSnapshot().report?.bankVersion.revision).toBe(originalRevision)
    expect(service.getSnapshot().outputs.filter((output) => output.status === 'completed')).toHaveLength(2)
    fail = false
    await service.retryFailed()
    expect(service.getSnapshot().report?.bankVersion.revision).toBe(originalRevision)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    service.regenerate()
    await service.start(model, 2)
    expect(service.getSnapshot()).toMatchObject({ concurrency: 2, bankVersion: { revision: 'f'.repeat(40) } })
    service.editOutput(0, '247 '.repeat(80))
    bank.version.revision = 'e'.repeat(40)
    service.analyze()
    expect(service.getSnapshot().report?.bankVersion.revision).toBe('e'.repeat(40))
  })

  it('coalesces preview notifications and immediately publishes terminal state', async () => {
    const service = new ModelTestSessionService()
    let send!: (chunk: Chunk) => void
    let finish!: () => void
    mocks.execute
      .mockImplementationOnce(
        (_prompt, _signal, onChunk) =>
          new Promise<void>((resolve) => {
            send = onChunk
            finish = () => {
              onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text: '1 '.repeat(300) } })
              resolve()
            }
          })
      )
      .mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 80))
    const notified = vi.fn()
    service.subscribe(notified)
    const run = service.start(model)
    await vi.advanceTimersByTimeAsync(0)
    notified.mockClear()
    for (let index = 0; index < 300; index++) send({ type: ChunkType.TEXT_DELTA, text: '1 ' })
    expect(notified).not.toHaveBeenCalled()
    expect(service.getSnapshot().outputs[0].parsedCount).toBe(300)
    const snapshot = service.getSnapshot()
    expect(service.getSnapshot()).toBe(snapshot)
    await vi.advanceTimersByTimeAsync(50)
    expect(notified).toHaveBeenCalledTimes(1)
    finish()
    await run
    expect(service.getSnapshot().phase).toBe('completed')
    const count = notified.mock.calls.length
    await vi.runAllTimersAsync()
    expect(notified).toHaveBeenCalledTimes(count)
  })

  it('isolates throwing and re-subscribing listeners from requests and other subscribers', async () => {
    const service = new ModelTestSessionService()
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 80))
    service.subscribe(() => {
      throw new Error('Minified React error #185')
    })
    let unsubscribe = () => {}
    const replacing = vi.fn(() => {
      unsubscribe()
      unsubscribe = service.subscribe(replacing)
    })
    unsubscribe = service.subscribe(replacing)
    const observed = vi.fn()
    service.subscribe(observed)
    await service.start(model)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(service.getSnapshot()).toMatchObject({ phase: 'completed', report: { used_outputs: 3 } })
    expect(replacing.mock.calls.length).toBeLessThan(30)
    expect(observed).toHaveBeenCalled()
  })

  it('discards scheduled previews and late callbacks after Stop and a new session', async () => {
    const service = new ModelTestSessionService()
    let oldChunk!: (chunk: Chunk) => void
    mocks.execute
      .mockImplementationOnce(
        (_prompt, signal, onChunk) =>
          new Promise((_resolve, reject) => {
            oldChunk = onChunk
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
      .mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 80))
    const run = service.start(model)
    await vi.advanceTimersByTimeAsync(0)
    oldChunk({ type: ChunkType.TEXT_DELTA, text: 'partial' })
    service.stop()
    await run
    const stopped = service.getSnapshot()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.getSnapshot()).toBe(stopped)
    await service.start(model)
    const complete = service.getSnapshot()
    oldChunk({ type: ChunkType.TEXT_DELTA, text: 'late' })
    await vi.runAllTimersAsync()
    expect(service.getSnapshot()).toBe(complete)
    expect(complete.phase).toBe('completed')
  })

  it('retains a system stop reason without retrying or treating it as a user stop', async () => {
    const service = new ModelTestSessionService()
    mocks.execute.mockImplementation(
      (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const run = service.start(model, 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    service.stop('system-budget')
    await run
    await vi.runAllTimersAsync()
    expect(service.getSnapshot()).toMatchObject({ phase: 'stopped', canRetry: true, completionReason: 'cancelled' })
    expect(service.getSnapshot().error).toContain('background time limit')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('keeps running across real hook unmount/remount and exposes the completed report without resending', async () => {
    const release = vi.fn()
    mocks.acquire.mockResolvedValue(release)
    const challenges = modelTestSession.getSnapshot().challenges
    let completeFirst!: () => void
    mocks.execute.mockImplementation((prompt, _signal, onChunk) => {
      const challenge = challenges.find((entry) => entry.prompt === prompt)!
      if (prompt === challenges[0].prompt)
        return new Promise<void>((resolve) => {
          completeFirst = () => {
            emit(onChunk, challenge.expected_count)
            resolve()
          }
        })
      emit(onChunk, challenge.expected_count)
      return Promise.resolve()
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const View = () => createElement('span', null, useModelTestSession().phase)
    let root = createRoot(container)
    let run!: Promise<void>
    await act(async () => {
      root.render(createElement(View))
      run = modelTestSession.start(model)
    })
    expect(container.textContent).toBe('running')
    const signal = mocks.execute.mock.calls[0][1] as AbortSignal
    await act(async () => {
      root.unmount()
    })
    expect(signal.aborted).toBe(false)
    completeFirst()
    await run
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(View))
    })
    expect(container.textContent).toBe('completed')
    expect(modelTestSession.getSnapshot().report?.used_outputs).toBe(3)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.unmount()
    })
  })

  it('freezes the run, rejects concurrent starts and retries failed groups against the old target', async () => {
    const service = new ModelTestSessionService()
    const challenges = service.getSnapshot().challenges
    let fail = true
    mocks.execute.mockImplementation(async (prompt, _signal, onChunk) => {
      const challenge = challenges.find((entry) => entry.prompt === prompt)!
      if (fail && prompt === challenges[0].prompt) throw new TypeError('connection reset')
      emit(onChunk, challenge.expected_count)
    })
    const selected = { ...model }
    const run = service.start(selected)
    selected.id = 'gpt-6-astra'
    selected.provider = 'two'
    await service.start(selected)
    await vi.runAllTimersAsync()
    await run
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.prepare.mock.calls[0][0]).toEqual(model)
    expect(service.getSnapshot().canRetry).toBe(true)
    expect(service.getSnapshot().outputs.map((output) => output.status)).toEqual(['error', 'completed', 'completed'])
    fail = false
    await service.retryFailed()
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(mocks.execute.mock.calls.map(([prompt]) => prompt)).toEqual([
      challenges[0].prompt,
      challenges[0].prompt,
      challenges[0].prompt,
      challenges[1].prompt,
      challenges[2].prompt,
      challenges[0].prompt
    ])
    expect(service.getSnapshot().target?.providerId).toBe('one')
    expect(service.getSnapshot().report?.used_outputs).toBe(3)
  })

  it('only Stop aborts an active request, and late output cannot replace the stopped state', async () => {
    const service = new ModelTestSessionService()
    let signal!: AbortSignal
    let late!: (chunk: Chunk) => void
    mocks.execute.mockImplementation(
      (_prompt, abortSignal, onChunk) =>
        new Promise((_resolve, reject) => {
          signal = abortSignal
          late = onChunk
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const run = service.start(model)
    await vi.advanceTimersByTimeAsync(0)
    service.stop()
    expect(signal.aborted).toBe(true)
    late({ type: ChunkType.TEXT_DELTA, text: 'late' })
    await run
    expect(service.getSnapshot().phase).toBe('stopped')
    expect(service.getSnapshot().completionReason).toBe('cancelled')
    expect(service.getSnapshot().outputs[0].text).toBe('')
  })

  it('cancels queued retries and clears old reports when manual answers change', async () => {
    const service = new ModelTestSessionService()
    const challenges = service.getSnapshot().challenges
    mocks.execute.mockRejectedValue(new TypeError('connection reset'))
    const run = service.start(model)
    await vi.advanceTimersByTimeAsync(0)
    service.stop()
    await vi.runAllTimersAsync()
    await run
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    challenges.forEach((challenge, index) =>
      service.editOutput(index, Array(challenge.expected_count).fill('247').join(' '))
    )
    service.analyze()
    expect(service.getSnapshot().report?.used_outputs).toBe(3)
    service.editOutput(0, 'wrong')
    expect(service.getSnapshot().report).toBeUndefined()
    expect(service.getSnapshot().canRetry).toBe(false)
    service.analyze()
    expect(service.getSnapshot().outputs[0]).toMatchObject({ status: 'completed', issue: 'format' })
    expect(service.getSnapshot().report?.used_outputs).toBe(2)
  })
  it('publishes partial reports during the run and retains them through Stop and failed-group retries', async () => {
    const service = new ModelTestSessionService()
    const challenges = service.getSnapshot().challenges
    let finishSecond!: () => void
    mocks.execute.mockImplementation((prompt, signal, onChunk) => {
      if (prompt === challenges[0].prompt) {
        emit(onChunk, 80)
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        finishSecond = () => {
          emit(onChunk, 1)
          resolve()
        }
      })
    })
    const run = service.start(model)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getSnapshot()).toMatchObject({ phase: 'running', report: { used_outputs: 1 } })
    finishSecond()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getSnapshot().outputs[1]).toMatchObject({ status: 'completed', usableCount: 1 })
    service.stop()
    await run
    expect(service.getSnapshot().report?.used_outputs).toBe(1)
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 80))
    await service.retryFailed()
    expect(mocks.execute.mock.calls.map(([prompt]) => prompt)).toEqual([
      challenges[0].prompt,
      challenges[1].prompt,
      challenges[2].prompt,
      challenges[2].prompt
    ])
    expect(service.getSnapshot()).toMatchObject({ phase: 'completed', canRetry: false, report: { used_outputs: 2 } })
  })

  it('uses the same eligibility for completed empty automatic and pasted answers', async () => {
    const service = new ModelTestSessionService()
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 0))
    await service.start(model)
    const automatic = service
      .getSnapshot()
      .outputs.map(({ status, issue, usableCount }) => ({ status, issue, usableCount }))
    expect(service.getSnapshot()).toMatchObject({ phase: 'completed', canRetry: false, report: undefined })
    service.analyze()
    expect(
      service.getSnapshot().outputs.map(({ status, issue, usableCount }) => ({ status, issue, usableCount }))
    ).toEqual(automatic)
  })

  it('keeps confidence success through peer cleanup, ignores Stop and disables retries', async () => {
    setProbability(0.5)
    const service = new ModelTestSessionService()
    const challenges = service.getSnapshot().challenges
    const releaseTask = vi.fn()
    let finishSecond!: () => void
    let releasePeer!: () => void
    let peerSignal!: AbortSignal
    mocks.acquire.mockResolvedValue(releaseTask)
    mocks.execute.mockImplementation((prompt, signal, onChunk) => {
      const challenge = challenges.find((entry) => entry.prompt === prompt)!
      if (prompt === challenges[0].prompt) {
        emit(onChunk, challenge.expected_count)
        return Promise.resolve()
      }
      if (prompt === challenges[1].prompt)
        return new Promise<void>((resolve) => {
          finishSecond = () => {
            emit(onChunk, challenge.expected_count)
            resolve()
          }
        })
      return new Promise<void>((_resolve, reject) => {
        peerSignal = signal
        releasePeer = () => reject(signal.reason)
      })
    })
    const run = service.start(model, 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.execute).toHaveBeenCalledTimes(3)

    setProbability(0.99)
    finishSecond()
    await vi.advanceTimersByTimeAsync(0)
    const duringCleanup = service.getSnapshot()
    expect(duringCleanup).toMatchObject({
      phase: 'running',
      completionReason: 'confidence-reached',
      report: { probability: 0.99, used_outputs: 2 }
    })
    expect(duringCleanup.outputs.map((output) => output.status)).toEqual(['completed', 'completed', 'skipped'])
    expect(peerSignal.aborted).toBe(true)
    service.stop()
    expect(service.getSnapshot()).toBe(duringCleanup)
    expect(releaseTask).not.toHaveBeenCalled()

    releasePeer()
    await run
    const completed = service.getSnapshot()
    expect(completed).toMatchObject({ phase: 'completed', completionReason: 'confidence-reached', canRetry: false })
    expect(releaseTask).toHaveBeenCalledTimes(1)
    await service.retryFailed()
    expect(service.getSnapshot()).toBe(completed)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
  })
})
