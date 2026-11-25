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
import { processLatexBrackets } from '@renderer/utils/markdown'

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

    // Never split inside unclosed \[...\] display math even when blank lines appear inside (> STREAM_TAIL_KEEP_CHARS)
    const unclosedBracketMath = `${closedIntro}\\[\nx = \\frac{1}{2}\n\n${'y = x + 1\n\n'.repeat(45)}`
    const mathSplit = splitStreamingMarkdownPrefix(unclosedBracketMath)
    expect(mathSplit.prefix).toBe(closedIntro)
    expect(mathSplit.tail.startsWith('\\[\n')).toBe(true)

    // Allow splitting after closed <svg>...</svg>, but never split inside an unclosed <svg>
    const unclosedSvg = `${closedIntro}<svg viewBox="0 0 100 100">\n\n${'<rect width="10" height="10" />\n\n'.repeat(25)}`
    const svgSplit = splitStreamingMarkdownPrefix(unclosedSvg)
    expect(svgSplit.prefix).toBe(closedIntro)
    expect(svgSplit.tail.startsWith('<svg')).toBe(true)

    const closedSvgThenProse = `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>\n\n${closedIntro}${'Tail paragraph.\n\n'.repeat(20)}`
    expect(splitStreamingMarkdownPrefix(closedSvgThenProse).prefix.length).toBeGreaterThan(1024)

    // Never split inside mixed-case <SvG>...</SvG> or multi-line \(...\) math
    const unclosedMixedSvg = `${closedIntro}<SvG viewBox="0 0 10 10">\n\n${'<path d="M0 0" />\n\n'.repeat(25)}</SvG>`
    expect(splitStreamingMarkdownPrefix(unclosedMixedSvg.slice(0, -6)).prefix).toBe(closedIntro)
    const unclosedParenMath = `${closedIntro}\\(\na + b\n\n${'c + d = x + y\n\n'.repeat(40)}`
    expect(splitStreamingMarkdownPrefix(unclosedParenMath).prefix).toBe(closedIntro)

    // Multi-line inline code, double-backtick inline code containing \[, and stray single backticks across paragraphs
    const doubleTickWithMath = `Paragraph with \`\`a \\[ b\`\` inline code.\n\n${closedIntro}${'More prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(doubleTickWithMath).prefix.length).toBeGreaterThan(1024)
    const multiLineInlineCodeWithMath = `Paragraph with \`line1\nline2 \\[ inside\` closed.\n\n${closedIntro}${'More prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(multiLineInlineCodeWithMath).prefix.length).toBeGreaterThan(1024)
    const strayBacktickInFirstPara = `Cost is \`100 in paragraph 1.\n\n${closedIntro}${'More prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(strayBacktickInFirstPara).prefix.length).toBeGreaterThan(1024)

    // Never split inside <svg> when <!-- </svg> --> or multi-line comments or <![CDATA[ </svg> ]]> appear inside <svg>
    const svgWithSingleLineComment = `${closedIntro}<svg viewBox="0 0 100 100">\n<!-- </svg> -->\n\n${'<rect width="10" height="10" />\n\n'.repeat(25)}`
    expect(splitStreamingMarkdownPrefix(svgWithSingleLineComment).prefix).toBe(closedIntro)
    expect(splitStreamingMarkdownPrefix(svgWithSingleLineComment).tail.startsWith('<svg')).toBe(true)

    const svgWithMultiLineComment = `${closedIntro}<svg viewBox="0 0 100 100">\n<!--\n  commented closing tag\n  </svg>\n-->\n\n${'<circle cx="5" cy="5" r="4" />\n\n'.repeat(25)}`
    expect(splitStreamingMarkdownPrefix(svgWithMultiLineComment).prefix).toBe(closedIntro)

    const svgWithCdata = `${closedIntro}<svg viewBox="0 0 100 100">\n<![CDATA[\n  </svg>\n]]>\n\n${'<path d="M0 0" />\n\n'.repeat(25)}`
    expect(splitStreamingMarkdownPrefix(svgWithCdata).prefix).toBe(closedIntro)

    // Closed <svg>...</svg> containing <!-- </svg> --> still allows prefix splitting after the real </svg>
    const closedSvgWithCommentThenProse = `<svg viewBox="0 0 10 10"><!-- </svg> --><circle cx="5" cy="5" r="4" /></svg>\n\n${closedIntro}${'Tail paragraph.\n\n'.repeat(20)}`
    const closedCommentedSplit = splitStreamingMarkdownPrefix(closedSvgWithCommentThenProse)
    expect(closedCommentedSplit.prefix.length).toBeGreaterThan(1024)
    expect(closedCommentedSplit.prefix.startsWith('<svg viewBox="0 0 10 10"><!-- </svg> -->')).toBe(true)

    // Unclosed multi-line XML comment outside <svg> must not split mid-comment, and inline code `<svg>` must not corrupt svgDepth
    const unclosedHtmlComment = `${closedIntro}<!--\n\n${'Comment paragraph.\n\n'.repeat(30)}`
    expect(splitStreamingMarkdownPrefix(unclosedHtmlComment).prefix).toBe(closedIntro)

    const inlineCodeSvgInProse = `Mentioning \`<svg>\` and \`</svg>\` in prose.\n\n${closedIntro}${'Tail prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(inlineCodeSvgInProse).prefix.length).toBeGreaterThan(1024)

    // CommonMark inline triple-backtick code span at start of line (` ```x``` `) and 4-space indented `    ``` ` must not lock activeFenceChar
    const inlineTripleTickAtLineStart = `\`\`\`const x = 1\`\`\` is inline code.\n\n${closedIntro}${'Tail prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(inlineTripleTickAtLineStart).prefix.length).toBeGreaterThan(1024)
    const indentedCodeFenceLine = `    \`\`\`\n\n${closedIntro}${'Tail prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(indentedCodeFenceLine).prefix.length).toBeGreaterThan(1024)

    // Single-line $$ ... $$ display math containing \[ must not corrupt outer bracketMathDepth
    const singleLineDisplayMathWithBracket = `$$ f(x) = \\[1, 2) $$\n\n${closedIntro}${'Tail prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(singleLineDisplayMathWithBracket).prefix.length).toBeGreaterThan(1024)

    // Child SVG elements with quoted "</svg>" or "<!--" must not prematurely close <svg> or open fake comments, and --!> closes HTML5 comments
    const svgWithQuotedAttrCloseAndBangComment = `${closedIntro}<svg viewBox="0 0 100 100">\n<g data-tip="</svg>" data-note="<!--">\n\n${'<rect width="10" height="10" />\n\n'.repeat(25)}`
    expect(splitStreamingMarkdownPrefix(svgWithQuotedAttrCloseAndBangComment).prefix).toBe(closedIntro)
    const bangClosedComment = `<!-- html5 bang close --!>\n\n${closedIntro}${'Tail prose.\n\n'.repeat(15)}`
    expect(splitStreamingMarkdownPrefix(bangClosedComment).prefix.length).toBeGreaterThan(1024)
  })

  it('converts balanced \\[...\\] and \\(...\\) in strictly linear O(N) time even on thousands of unclosed delimiters', () => {
    const input = [
      'Inline \\(a + b\\) and escaped \\\\(not math\\\\) plus `code \\(skip\\)` and [link \\(skip\\)](https://example.invalid).',
      '\\[\n\\sum_{i=1}^{n} \\left[ x_i \\right]\n\\]',
      'Unclosed outer \\[ prefix with inner \\[ y + z \\] and trailing unfinished \\[\nx_1 + x_2'
    ].join('\n\n')
    const output = processLatexBrackets(input)
    expect(output).toContain('Inline $a + b$')
    expect(output).toContain('\\\\(not math\\\\)')
    expect(output).toContain('`code \\(skip\\)`')
    expect(output).toContain('[link \\(skip\\)](https://example.invalid)')
    expect(output).toContain('$$\n\\sum_{i=1}^{n} \\left[ x_i \\right]\n$$')
    expect(output).toContain('Unclosed outer \\[ prefix with inner $$ y + z $$ and trailing unfinished \\[\nx_1 + x_2')

    // Pathological adversarial input: 1,600 unclosed \[ followed by 1 closed \[ x \] must finish in < 50ms (was ~3,951ms)
    const pathological = `${'\\[ unclosed '.repeat(1600)}\\[ x + 1 \\]`
    const t0 = performance.now()
    const pathOut = processLatexBrackets(pathological)
    const elapsedMs = performance.now() - t0
    expect(pathOut.endsWith('$$ x + 1 $$')).toBe(true)
    expect(elapsedMs).toBeLessThan(100)
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
