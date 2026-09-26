// @vitest-environment jsdom
import { useModelTestSession } from '@renderer/hooks/useModelTestSession'
import type { Model } from '@renderer/types'
import { type Chunk, ChunkType } from '@renderer/types/chunk'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), prepare: vi.fn() }))
vi.mock('./directModelTest', () => ({ prepareDirectModelTest: mocks.prepare }))

import { modelTestSession, ModelTestSessionService } from './ModelTestSessionService'

const model: Model = { id: 'gpt-6-sol', provider: 'one', name: 'Sol', group: '' }
const emit = (onChunk: (chunk: Chunk) => void, count: number) => {
  const text = Array(count).fill('247').join(' ')
  onChunk({ type: ChunkType.TEXT_START })
  onChunk({ type: ChunkType.TEXT_DELTA, text })
  onChunk({ type: ChunkType.TEXT_COMPLETE, text })
  onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text } })
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.execute.mockReset()
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
  it('keeps running across real hook unmount/remount and exposes the completed report without resending', async () => {
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
      emit(onChunk, fail && prompt === challenges[0].prompt ? 1 : challenge.expected_count)
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
    expect(service.getSnapshot().outputs.map((output) => output.status)).toEqual(['invalid', 'valid', 'valid'])
    fail = false
    await service.retryFailed()
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
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
    expect(service.getSnapshot().outputs[0].text).toBe('')
  })

  it('cancels queued retries and clears old reports when manual answers change', async () => {
    const service = new ModelTestSessionService()
    const challenges = service.getSnapshot().challenges
    mocks.execute.mockImplementation(async (_prompt, _signal, onChunk) => emit(onChunk, 1))
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
    expect(service.getSnapshot().outputs[0].status).toBe('invalid')
  })
})
