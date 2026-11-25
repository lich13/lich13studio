// @vitest-environment jsdom
import assistantsReducer, { removeAllTopics } from '@renderer/store/assistants'
import type { Assistant, Topic } from '@renderer/types'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ codeShowLineNumbers: true, fontSize: 14 })
}))
vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({
    getShikiPreProperties: async () => ({ class: 'shiki', style: '' }),
    isShikiThemeDark: true
  })
}))
vi.mock('@renderer/hooks/useCodeHighlight', () => ({
  useCodeHighlight: ({ rawLines }: { rawLines: string[] }) => ({
    tokenLines: rawLines.map((line) => [{ content: line, offset: 0, color: '#e6edf3' }]),
    highlightLines: vi.fn(async () => {})
  })
}))
vi.mock('@renderer/store', () => ({
  useAppSelector: vi.fn((selector: (state: any) => unknown) =>
    selector({
      settings: { codeFancyBlock: true },
      messageBlocks: { entities: {} }
    })
  )
}))
vi.mock('@renderer/components/CodeBlockView', () => ({
  CodeBlockView: ({ language, children }: { language: string; children: string }) =>
    createElement('div', { 'data-testid': 'fenced-code', 'data-lang': language }, children),
  HtmlArtifactsCard: ({ html }: { html: string }) => createElement('div', { 'data-testid': 'html-artifact' }, html)
}))

import CodeViewer from '@renderer/components/CodeViewer'

import CodeBlock, { areCodeBlockPropsEqual } from './CodeBlock'
import { splitStreamingMarkdownPrefix } from './Markdown'

describe('Pure removeAllTopics reducer & Markdown/CodeViewer optimizations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps removeAllTopics reducer pure and deterministic when explicit defaultTopic is supplied', () => {
    const explicitDefault: Topic = {
      id: 'deterministic-topic-id',
      assistantId: 'assistant-1',
      name: 'Default',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    }
    const initialAssistant = {
      id: 'assistant-1',
      name: 'Coder',
      prompt: '',
      type: 'chat',
      topics: [
        {
          id: 'old-topic-1',
          assistantId: 'assistant-1',
          name: 'Old 1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messages: []
        }
      ]
    } as unknown as Assistant

    const nextState = assistantsReducer(
      {
        defaultAssistant: initialAssistant,
        assistants: [initialAssistant],
        tagsOrder: [],
        presets: []
      },
      removeAllTopics({ assistantId: 'assistant-1', defaultTopic: explicitDefault })
    )

    expect(nextState.assistants[0].topics).toEqual([explicitDefault])
  })

  it('compares CodeBlock props by AST offsets rather than fresh node references and renders inline vs fenced cleanly', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const prevProps = {
      children: 'const x = 1',
      className: undefined,
      blockId: 'blk-1',
      node: {
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 14, offset: 13 }
        }
      }
    }
    const nextPropsSame = {
      ...prevProps,
      node: {
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 14, offset: 13 }
        }
      }
    }
    expect(areCodeBlockPropsEqual(prevProps, nextPropsSame)).toBe(true)
    expect(areCodeBlockPropsEqual(prevProps, { ...nextPropsSame, children: 'const x = 2' })).toBe(false)

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(CodeBlock, { blockId: 'blk-1', children: 'inlineValue' }),
          createElement(CodeBlock, {
            blockId: 'blk-1',
            className: 'language-ts',
            children: 'export const answer = 42\n'
          })
        )
      )
    })

    expect(container.querySelector('code')?.textContent).toBe('inlineValue')
    expect(container.querySelector('[data-testid="fenced-code"]')?.getAttribute('data-lang')).toBe('ts')

    await act(async () => {
      root.unmount()
    })
  })

  it('splits long streaming Markdown only at closed fence-safe boundaries and preserves lists/HTML/ref-links', () => {
    const closedIntro = `${'Paragraph line with prose and `inline` code.\n\n'.repeat(35)}`
    const unclosedFence = `\`\`\`python\ndef compute():\n\n${'    value = compute_step()\n\n'.repeat(25)}    return 42\n`
    const split = splitStreamingMarkdownPrefix(closedIntro + unclosedFence)
    expect(split.prefix.length).toBeGreaterThan(1024)
    expect(split.prefix.includes('```python')).toBe(false)
    expect(split.tail.startsWith('```python')).toBe(true)
    expect(split.prefix + split.tail).toBe(closedIntro + unclosedFence)

    // Never split inside multi-paragraph indented list continuations or loose ordered lists
    const looseList = Array.from(
      { length: 20 },
      (_, idx) => `${idx + 1}. List item ${idx + 1} header\n\n   Indented continuation paragraph ${'x'.repeat(80)}\n`
    ).join('\n')
    expect(splitStreamingMarkdownPrefix(looseList).prefix).toBe('')

    // Never split documents containing reference-style link definitions or <details> containers
    const withRefLinks = `${closedIntro}[See docs][ref-1]\n\n[ref-1]: https://example.invalid\n`
    expect(splitStreamingMarkdownPrefix(withRefLinks).prefix).toBe('')
    const withDetails = `<details><summary>Fold</summary>\n\n${closedIntro}\n\n</details>`
    expect(splitStreamingMarkdownPrefix(withDetails).prefix).toBe('')
  })

  it('renders expanded CodeViewer statically without attaching global selectionchange listeners', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const addDocListenerSpy = vi.spyOn(document, 'addEventListener')

    const container = document.createElement('div')
    const root = createRoot(container)
    const code = Array.from({ length: 12 }, (_, idx) => `const row_${idx} = ${idx};`).join('\n')

    await act(async () => {
      root.render(createElement(CodeViewer, { value: code, language: 'typescript', expanded: true }))
    })

    const selectionCalls = addDocListenerSpy.mock.calls.filter(([event]) => event === 'selectionchange')
    expect(selectionCalls).toHaveLength(0)
    expect(container.querySelectorAll('.line')).toHaveLength(12)
    expect(container.textContent).toContain('const row_11 = 11;')

    await act(async () => {
      root.unmount()
    })
    addDocListenerSpy.mockRestore()
  })
})
