// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FingerprintCore from './fingerprintCore'

const fixtures = vi.hoisted(() => ({
  execute: vi.fn(),
  prepare: vi.fn(),
  rewriteReport: vi.fn(),
  dispatch: vi.fn(),
  llm: {
    modelTestConcurrency: 1,
    modelTestSelection: { platform: 'openai', modelId: 'gpt-6-luna', providerId: 'happy' },
    platformModels: { openai: [{ id: 'gpt-6-luna', name: 'gpt-6-luna', group: '' }], grok: [], anthropic: [] },
    providers: [{ id: 'happy', name: 'Happy Code', platform: 'openai', enabled: true }]
  }
}))
vi.mock('./directModelTest', () => ({ prepareDirectModelTest: fixtures.prepare }))
vi.mock('./fingerprintCore', async (importOriginal) => {
  const actual = await importOriginal<typeof FingerprintCore>()
  return {
    ...actual,
    analyzeGlobalOutputs: (...args: Parameters<typeof actual.analyzeGlobalOutputs>) => {
      const report = actual.analyzeGlobalOutputs(...args)
      const rewrite = fixtures.rewriteReport.getMockImplementation()
      return rewrite ? rewrite(report, ...args) : report
    }
  }
})
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
vi.mock('@renderer/store', () => ({
  useAppSelector: (select: any) => select({ llm: fixtures.llm }),
  useAppDispatch: () => fixtures.dispatch
}))
vi.mock('@renderer/store/llm', () => ({
  setModelTestSelection: vi.fn(),
  setModelTestConcurrency: (value: number) => ({ type: 'llm/setModelTestConcurrency', payload: value })
}))
vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => null }))
vi.mock('@renderer/components/ModelTagsWithLabel', () => ({ default: () => null }))
vi.mock('@renderer/config/models', () => ({ isEmbeddingModel: () => false, isRerankModel: () => false }))
vi.mock('@renderer/context/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dark' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/pages/settings', async () => {
  const { default: styled } = await import('styled-components')
  return {
    SettingContainer: styled.div``,
    SettingGroup: styled.div``,
    SettingTitle: styled.div``,
    SettingDescription: styled.div``
  }
})
vi.mock('@renderer/components/app/Navbar', async () => {
  const { default: styled } = await import('styled-components')
  return { Navbar: styled.div``, NavbarCenter: styled.div`` }
})

import ModelTestPage from '@renderer/pages/model-test/ModelTestPage'
import ModelTestViewBoundary from '@renderer/pages/model-test/ModelTestViewBoundary'
import { type Chunk, ChunkType } from '@renderer/types/chunk'

import { modelTestSession } from './ModelTestSessionService'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {}
    }))
  )
  fixtures.execute.mockReset()
  fixtures.rewriteReport
    .mockReset()
    .mockImplementation((report: any) => (report ? { ...report, probability: 0.5 } : report))
  fixtures.dispatch.mockReset()
  fixtures.llm.modelTestConcurrency = 1
  fixtures.prepare.mockReset().mockResolvedValue({
    target: { providerId: 'happy', providerName: 'Happy Code', modelId: 'gpt-6-luna' },
    execute: fixtures.execute
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
    modelTestSession.stop()
    modelTestSession.regenerate()
  })
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('real ModelTestPage rendering', () => {
  it('runs the first request alone, then honors up to two remaining requests and restores the view on return', async () => {
    const pending: Array<{ onChunk: (chunk: Chunk) => void; resolve: () => void }> = []
    fixtures.execute.mockImplementation(
      (_prompt, signal, onChunk) =>
        new Promise<void>((resolve, reject) => {
          pending.push({ onChunk, resolve })
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const renderPage = () => root.render(createElement(MemoryRouter, null, createElement(ModelTestPage)))
    await act(async () => renderPage())
    await act(async () => {
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2].click()
    })
    expect(fixtures.dispatch).toHaveBeenCalledWith({ type: 'llm/setModelTestConcurrency', payload: 3 })
    fixtures.llm.modelTestConcurrency = 3
    await act(async () => renderPage())
    await act(async () => {
      const run = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'settings.modelTest.run'
      )!
      run.click()
    })
    expect(pending).toHaveLength(1)
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every((i) => i.disabled)).toBe(true)
    await act(async () => root.render(createElement('div', null, 'home')))
    expect(modelTestSession.getSnapshot().phase).toBe('running')
    const complete = async (index: number, value: number) => {
      await act(async () => {
        const text = Array(80).fill(String(value)).join(' ')
        pending[index].onChunk({ type: ChunkType.TEXT_DELTA, text })
        pending[index].onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text }, finishReason: 'stop' })
        pending[index].resolve()
        await vi.advanceTimersByTimeAsync(50)
        await Promise.resolve()
      })
    }
    await complete(0, 101)
    expect(pending).toHaveLength(3)
    for (const index of [2, 1]) await complete(index, index + 101)
    await act(async () => renderPage())
    expect(modelTestSession.getSnapshot()).toMatchObject({
      phase: 'completed',
      concurrency: 3,
      report: { used_outputs: 3, concurrency: 3 }
    })
    expect([...container.querySelectorAll('textarea')].map((input) => input.value)).toEqual(
      [101, 102, 103].map((value) => Array(80).fill(String(value)).join(' '))
    )
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every((i) => !i.disabled)).toBe(
      true
    )
  })

  it('renders high-frequency streamed chunks and all three results without nesting React updates', async () => {
    const challenges = modelTestSession.getSnapshot().challenges
    const pending: Array<{ onChunk: (chunk: Chunk) => void; resolve: () => void }> = []
    fixtures.execute.mockImplementation(
      (_prompt, signal, onChunk) =>
        new Promise<void>((resolve, reject) => {
          pending.push({ onChunk, resolve })
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ModelTestPage)))
    })
    let run!: Promise<void>
    await act(async () => {
      run = modelTestSession.start({ id: 'gpt-6-luna', name: 'gpt-6-luna', group: '', provider: 'happy' })
    })
    for (let group = 0; group < 3; group++) {
      expect(pending).toHaveLength(group + 1)
      const request = pending[group]
      const text = Array(challenges[group].expected_count).fill('247').join(' ')
      for (let offset = 0; offset < text.length; offset += 37) {
        await act(async () => {
          for (const character of text.slice(offset, offset + 37))
            request.onChunk({ type: ChunkType.TEXT_DELTA, text: character })
          await vi.advanceTimersByTimeAsync(50)
        })
      }
      await act(async () => {
        request.onChunk({ type: ChunkType.TEXT_COMPLETE, text })
        request.onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text }, finishReason: 'stop' })
        request.resolve()
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    await act(async () => {
      await run
    })
    expect(fixtures.execute).toHaveBeenCalledTimes(3)
    expect(modelTestSession.getSnapshot()).toMatchObject({ phase: 'completed', report: { used_outputs: 3 } })
    expect(container.querySelectorAll('textarea')).toHaveLength(3)
    expect([...container.querySelectorAll('textarea')].map((input) => input.value)).toEqual(
      challenges.map((challenge) => Array(challenge.expected_count).fill('247').join(' '))
    )
    expect(container.textContent).not.toContain('settings.modelTest.restoreView')
  }, 20000)

  it('recovers a failed view once without restarting the background runner, then permits manual recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let broken = true
    const failingView = vi.fn(() => {
      if (broken) throw new Error('test render failure')
      return createElement(ModelTestPage)
    })
    let finish!: () => void
    fixtures.execute.mockImplementation(
      (_prompt, _signal, onChunk) =>
        new Promise<void>((resolve) => {
          finish = () => {
            onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text: '' } })
            resolve()
          }
        })
    )
    const run = modelTestSession.start({ id: 'gpt-6-luna', name: '', group: '', provider: 'happy' })
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(MemoryRouter, null, createElement(ModelTestViewBoundary, null, createElement(failingView)))
        )
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    const calls = failingView.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(failingView).toHaveBeenCalledTimes(calls)
    expect(fixtures.execute).toHaveBeenCalledTimes(1)
    expect(modelTestSession.getSnapshot().phase).toBe('running')
    expect(container.textContent).toContain('settings.modelTest.restoreView')
    broken = false
    await act(async () => {
      container.querySelector('button')!.click()
    })
    expect(container.textContent).not.toContain('settings.modelTest.restoreView')
    for (let i = 0; i < 3; i++)
      await act(async () => {
        finish()
      })
    await act(async () => {
      await run
    })
    expect(fixtures.execute).toHaveBeenCalledTimes(3)
    expect(modelTestSession.getSnapshot().phase).toBe('completed')
  })

  it('shows early completion and preserves the result after leaving and returning to the page', async () => {
    fixtures.rewriteReport.mockImplementation((report: any) => (report ? { ...report, probability: 0.99 } : report))
    const pending: Array<{ onChunk: (chunk: Chunk) => void; resolve: () => void }> = []
    fixtures.execute.mockImplementation(
      (_prompt, signal, onChunk) =>
        new Promise<void>((resolve, reject) => {
          pending.push({ onChunk, resolve })
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const renderPage = () => root.render(createElement(MemoryRouter, null, createElement(ModelTestPage)))

    await act(async () => renderPage())
    await act(async () => {
      const run = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'settings.modelTest.run'
      )!
      run.click()
    })
    expect(fixtures.execute).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)

    const challenge = modelTestSession.getSnapshot().challenges[0]
    const text = Array(challenge.expected_count).fill('101').join(' ')
    await act(async () => {
      pending[0].onChunk({ type: ChunkType.TEXT_DELTA, text })
      pending[0].onChunk({ type: ChunkType.LLM_RESPONSE_COMPLETE, response: { text }, finishReason: 'stop' })
      pending[0].resolve()
      await vi.advanceTimersByTimeAsync(50)
      await Promise.resolve()
    })

    const expectedResult = {
      phase: 'completed',
      completionReason: 'confidence-reached',
      canRetry: false,
      report: { probability: 0.99, used_outputs: 1 }
    }
    expect(modelTestSession.getSnapshot()).toMatchObject(expectedResult)
    expect(modelTestSession.getSnapshot().outputs.map((output) => output.status)).toEqual([
      'completed',
      'skipped',
      'skipped'
    ])
    expect(container.textContent).toContain('settings.modelTest.earlyCompleted')
    expect(container.textContent).not.toContain('settings.modelTest.retryFailed')
    expect(fixtures.execute).toHaveBeenCalledTimes(1)

    await act(async () => root.render(createElement('div', null, 'home')))
    await act(async () => renderPage())
    expect(modelTestSession.getSnapshot()).toMatchObject(expectedResult)
    expect(modelTestSession.getSnapshot().outputs.map((output) => output.status)).toEqual([
      'completed',
      'skipped',
      'skipped'
    ])
    expect(container.textContent).toContain('settings.modelTest.earlyCompleted')
    expect(container.textContent).not.toContain('settings.modelTest.retryFailed')
    expect(fixtures.execute).toHaveBeenCalledTimes(1)
  })
})
