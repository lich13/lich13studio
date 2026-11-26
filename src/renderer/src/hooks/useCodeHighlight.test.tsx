// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeShikiTheme: 'one-light',
  cleanupCalls: [] as string[],
  highlightCalls: [] as Array<{ code: string; language: string; callerId: string }>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() })
  }
}))

import { shikiStreamService } from '@renderer/services/ShikiStreamService'

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    activeShikiTheme: mocks.activeShikiTheme,
    highlightStreamingCode: async (code: string, language: string, callerId: string) => {
      mocks.highlightCalls.push({ code, language, callerId })
      return shikiStreamService.highlightStreamingCode(code, language, mocks.activeShikiTheme, callerId)
    },
    cleanupTokenizers: (callerId: string) => {
      mocks.cleanupCalls.push(callerId)
      shikiStreamService.cleanupTokenizers(callerId)
    }
  })
}))

import { useCodeHighlight } from './useCodeHighlight'

describe('useCodeHighlight + ShikiStreamService streaming & cache lifecycle', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let chunkGates: Map<string, Promise<void>>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.activeShikiTheme = 'one-light'
    mocks.cleanupCalls.length = 0
    mocks.highlightCalls.length = 0
    chunkGates = new Map()
    shikiStreamService.dispose()

    // Simulate incremental ShikiStreamTokenizer behavior on highlightCodeChunk
    const callerLines = new Map<string, string[]>()
    vi.spyOn(shikiStreamService, 'highlightCodeChunk').mockImplementation(
      async (chunk: string, language: string, theme: string, callerId: string) => {
        const gate = chunkGates.get(chunk)
        if (gate) {
          await gate
        }
        const key = `${callerId}-${language}-${theme}`
        const prev = callerLines.get(key)
        if (!prev) {
          const split = chunk.split('\n')
          callerLines.set(key, split)
          return {
            lines: split.map((line) => [{ content: line, offset: 0 }]),
            recall: 0
          }
        }
        const combined = [...prev.slice(0, -1), (prev[prev.length - 1] ?? '') + chunk].join('\n').split('\n')
        const recall = 1
        const deltaLines = combined.slice(prev.length - 1)
        callerLines.set(key, combined)
        return {
          lines: deltaLines.map((line) => [{ content: line, offset: 0 }]),
          recall
        }
      }
    )
    const origCleanup = shikiStreamService.cleanupTokenizers.bind(shikiStreamService)
    vi.spyOn(shikiStreamService, 'cleanupTokenizers').mockImplementation((callerId: string) => {
      for (const key of callerLines.keys()) {
        if (key.startsWith(`${callerId}-`)) {
          callerLines.delete(key)
        }
      }
      origCleanup(callerId)
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('highlights single-line appends, multi-line growth, releases cache on stream end without duplicating on re-run, and replaces shrunk code', async () => {
    let latestHook!: ReturnType<typeof useCodeHighlight>

    function Probe({
      code,
      language = 'ts',
      callerId = 'caller-1'
    }: {
      code: string
      language?: string
      callerId?: string
    }) {
      const rawLines = code.trimEnd().split('\n')
      latestHook = useCodeHighlight({ rawLines, language, callerId })
      return createElement(
        'pre',
        null,
        latestHook.tokenLines.map((line) => line.map((t) => t.content).join('')).join('\n')
      )
    }

    // 1. Initial single-line chunk
    await act(async () => {
      root.render(createElement(Probe, { code: 'const' }))
    })
    await act(async () => {
      await latestHook.highlightLines(1, false)
    })
    expect(container.textContent).toBe('const')

    // 2. Single-line append (line count stays 1, text grows)
    await act(async () => {
      root.render(createElement(Probe, { code: 'const answer = 42' }))
    })
    await act(async () => {
      await latestHook.highlightLines(1, false)
    })
    expect(container.textContent).toBe('const answer = 42')

    // 3. Multi-line growth + stream end (`releaseCacheAfter = true`)
    await act(async () => {
      root.render(createElement(Probe, { code: 'const answer = 42\nexport default answer' }))
    })
    await act(async () => {
      await latestHook.highlightLines(2, true)
    })
    expect(container.textContent).toBe('const answer = 42\nexport default answer')
    expect(mocks.cleanupCalls).toContain('caller-1')

    // 4. Redundant re-run with identical content does zero extra worker calls
    const callCountAfterEnd = mocks.highlightCalls.length
    await act(async () => {
      await latestHook.highlightLines(2, true)
    })
    expect(mocks.highlightCalls.length).toBe(callCountAfterEnd)
    expect(container.textContent).toBe('const answer = 42\nexport default answer')

    // 5. Appending after cache was released rebuilds cleanly with recall=-1 instead of duplicating lines
    await act(async () => {
      root.render(createElement(Probe, { code: 'const answer = 42\nexport default answer\n// done' }))
    })
    await act(async () => {
      await latestHook.highlightLines(3, true)
    })
    expect(latestHook.tokenLines).toHaveLength(3)
    expect(container.textContent).toBe('const answer = 42\nexport default answer\n// done')

    // 6. Editing/shrinking from 3 lines down to 1 line replaces stale tokens cleanly
    await act(async () => {
      root.render(createElement(Probe, { code: 'let next = 1' }))
    })
    await act(async () => {
      await latestHook.highlightLines(1, true)
    })
    expect(latestHook.tokenLines).toHaveLength(1)
    expect(container.textContent).toBe('let next = 1')
  })

  it('prevents stale B tokens from overwriting A in an A -> B -> A race while B is in-flight, and coalesces duplicate B -> B', async () => {
    let latestHook!: ReturnType<typeof useCodeHighlight>

    function Probe({ code }: { code: string }) {
      const rawLines = code.trimEnd().split('\n')
      latestHook = useCodeHighlight({ rawLines, language: 'ts', callerId: 'caller-race' })
      return createElement(
        'pre',
        null,
        latestHook.tokenLines.map((line) => line.map((t) => t.content).join('')).join('\n')
      )
    }

    // 1. Highlight A cleanly
    await act(async () => {
      root.render(createElement(Probe, { code: 'const alpha = 1' }))
    })
    await act(async () => {
      await latestHook.highlightLines(1, true)
    })
    expect(container.textContent).toBe('const alpha = 1')

    // 2. Intercept the worker call for B so it stays in-flight while code switches back to A
    let releaseB!: () => void
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    chunkGates.set('const beta = 2', bGate)

    await act(async () => {
      root.render(createElement(Probe, { code: 'const beta = 2' }))
    })
    let inFlightB!: Promise<void>
    act(() => {
      inFlightB = latestHook.highlightLines(1, true)
    })

    // Duplicate B request while B is in-flight should coalesce without a second B worker call
    act(() => {
      void latestHook.highlightLines(1, true)
    })

    // Switch back to A while B is STILL in-flight (lastHighlightedContentRef is still A!),
    // and gate A's worker re-highlight so we can inspect intermediate state right after B resolves!
    let releaseA2!: () => void
    const a2Gate = new Promise<void>((resolve) => {
      releaseA2 = resolve
    })
    chunkGates.set('const alpha = 1', a2Gate)

    await act(async () => {
      root.render(createElement(Probe, { code: 'const alpha = 1' }))
    })
    act(() => {
      void latestHook.highlightLines(1, true)
    })

    // Release B while A's worker re-highlight is STILL in-flight: must NOT flash stale B tokens!
    chunkGates.delete('const beta = 2')
    await act(async () => {
      releaseB()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toBe('const alpha = 1')

    // Now release A's worker re-highlight and let the worker loop drain completely
    chunkGates.delete('const alpha = 1')
    await act(async () => {
      releaseA2()
      await inFlightB
    })

    // Final rendered tokens MUST match A ('const alpha = 1'), NOT stale B ('const beta = 2')
    expect(container.textContent).toBe('const alpha = 1')

    // Transitioning from non-empty code to empty/whitespace clears stale tokenLines immediately
    await act(async () => {
      root.render(createElement(Probe, { code: '   ' }))
    })
    await act(async () => {
      await latestHook.highlightLines(1, true)
    })
    expect(latestHook.tokenLines).toEqual([])
    expect(container.textContent).toBe('')

    // Also verify A -> B -> B coalescing when final state stays B
    let releaseGamma!: () => void
    const gammaGate = new Promise<void>((resolve) => {
      releaseGamma = resolve
    })
    chunkGates.set('const gamma = 3', gammaGate)

    await act(async () => {
      root.render(createElement(Probe, { code: 'const gamma = 3' }))
    })
    const callsBeforeGamma = mocks.highlightCalls.filter((c) => c.code === 'const gamma = 3').length
    let inFlightGamma!: Promise<void>
    act(() => {
      inFlightGamma = latestHook.highlightLines(1, true)
      void latestHook.highlightLines(1, true)
    })
    chunkGates.delete('const gamma = 3')
    await act(async () => {
      releaseGamma()
      await inFlightGamma
    })
    const callsAfterGamma = mocks.highlightCalls.filter((c) => c.code === 'const gamma = 3').length
    expect(callsAfterGamma - callsBeforeGamma).toBe(1)
    expect(container.textContent).toBe('const gamma = 3')
  })
})
