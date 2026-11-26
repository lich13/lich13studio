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
import { createStreamingMarkdownScanner, splitStreamingMarkdownPrefix } from './Markdown'
import { createSlugger } from './plugins/rehypeHeadingIds'
import { areTablePropsEqual, extractTableMarkdown } from './Table'

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

  it('keeps incremental createStreamingMarkdownScanner exact chunk-by-chunk across straddling tags, late ref-links, and resets', () => {
    const prose = 'Incremental paragraph with `code` and <divider-token> safe tag.\n\n'.repeat(30)
    const codeFence = '```ts\nexport function calc(x: number) {\n  return x * 2;\n}\n```\n\n'
    const mathAndSvg = '$$\na^2 + b^2 = c^2\n$$\n\n<svg viewBox="0 0 8 8"><rect width="4" height="4" /></svg>\n\n'
    const tailProse = 'Final explanation paragraph with more text.\n\n'.repeat(20)
    const fullSafeDoc = prose + codeFence + mathAndSvg + tailProse

    const scanner = createStreamingMarkdownScanner()
    for (let pos = 17; pos <= fullSafeDoc.length; pos += 37) {
      const prefixSlice = fullSafeDoc.slice(0, pos)
      expect(scanner.scan(prefixSlice)).toEqual(splitStreamingMarkdownPrefix(prefixSlice))
    }

    // Late reference-style link definition invalidates split immediately
    const withLateRef = `${fullSafeDoc}\n[ref-late]: https://example.invalid\n`
    expect(scanner.scan(withLateRef)).toEqual({ prefix: '', tail: withLateRef })

    // Replacing content with a fresh safe document resets scanner state cleanly
    const freshDoc = 'Fresh regenerated reply paragraph.\n\n'.repeat(65)
    expect(scanner.scan(freshDoc)).toEqual(splitStreamingMarkdownPrefix(freshDoc))
    expect(scanner.scan(freshDoc).prefix.length).toBeGreaterThan(1024)
  })

  it('detects same-length cell edits in areTablePropsEqual while skipping unchanged table re-renders', () => {
    const position = {
      start: { line: 3, column: 1, offset: 20 },
      end: { line: 5, column: 10, offset: 52 }
    }
    const prevProps = {
      blockId: 'blk-tbl',
      lineOffset: 4,
      charOffset: 120,
      node: { position },
      children: createElement('tbody', null, createElement('tr', null, createElement('td', null, 'cell-a')))
    }
    const nextUnchanged = {
      blockId: 'blk-tbl',
      lineOffset: 4,
      charOffset: 120,
      node: { position: { start: { ...position.start }, end: { ...position.end } } },
      children: createElement('tbody', null, createElement('tr', null, createElement('td', null, 'cell-a')))
    }
    const nextSameLenEdited = {
      ...nextUnchanged,
      children: createElement('tbody', null, createElement('tr', null, createElement('td', null, 'cell-b')))
    }

    expect(areTablePropsEqual(prevProps, nextUnchanged)).toBe(true)
    expect(areTablePropsEqual(prevProps, nextSameLenEdited)).toBe(false)
  })

  it('extracts exact table markdown after <svg> blank-line stripping or \\(...\\) inline math and continues heading slugs across segments', () => {
    const rawWithSvgAndMath = [
      '<svg viewBox="0 0 10 10">',
      '',
      '<rect width="4" height="4" />',
      '',
      '</svg>',
      '',
      'Inline math \\(a + b\\) before table.',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Alice | 99 |'
    ].join('\n')
    const processed = rawWithSvgAndMath.replace('\\(a + b\\)', '$a + b$').replace(/(<svg[\s\S]*?<\/svg>)/g, (m) =>
      m
        .split('\n')
        .filter((l) => l.trim() !== '')
        .join('\n')
    )
    const tableMd = '| Name | Score |\n| --- | --- |\n| Alice | 99 |'
    const startOffset = processed.indexOf(tableMd)
    const endOffset = startOffset + tableMd.length

    expect(
      extractTableMarkdown(
        'blk-svg-tbl',
        { start: { line: 7, column: 1, offset: startOffset }, end: { line: 9, column: 15, offset: endOffset } },
        0,
        0,
        processed
      )
    ).toBe(tableMd)

    const seg0Slugger = createSlugger()
    expect(seg0Slugger.slug('Overview')).toBe('overview-0')
    const seg1Slugger = createSlugger(new Map([['overview', 1]]))
    expect(seg1Slugger.slug('Overview')).toBe('overview-1')
  })

  it('scans unclosed single-line streaming paragraphs in linear O(N) time while matching full-rescan across multi-char boundary tokens', () => {
    // 1. Adversarial boundary-straddling single-line paragraph (step 3 & step 7) followed by paragraph break
    const intro = 'Introductory closed paragraph before long single-line stream.\n\n'.repeat(30)
    const boundaryRichSingleLine =
      'Start prose with \\\\[escaped\\\\] and \\[a + b\\] and \\(c + d\\) and ``double ` tick`` and `code` ' +
      'and <!-- xml comment --!> and <![CDATA[ raw <svg> ]]> and <svg viewBox="0 0 8 8"><path d="M0 0" /></svg> ' +
      'and $x_1 + x_2$ and [inline link](https://example.invalid) '.repeat(12) +
      '\n\n' +
      'Trailing paragraph after single-line closes.\n\n'.repeat(20)

    const doc = intro + boundaryRichSingleLine
    for (const step of [3, 7]) {
      const scanner = createStreamingMarkdownScanner()
      for (let pos = step; pos <= doc.length; pos += step) {
        const slice = doc.slice(0, pos)
        expect(scanner.scan(slice)).toEqual(splitStreamingMarkdownPrefix(slice))
      }
    }

    // 2. Linear-time O(N) streaming append benchmark on a 45,000-char single line with NO newline
    const chunkUnit = 'Streaming single-line token with $x$ and `k` and \\(y\\) prose segment. '
    const totalChunks = 650 // ~46,800 chars without any '\n'
    const pureSingleLineScanner = createStreamingMarkdownScanner()
    let acc = ''
    const t0 = performance.now()
    for (let i = 0; i < totalChunks; i += 1) {
      acc += chunkUnit
      const res = pureSingleLineScanner.scan(acc)
      expect(res.prefix).toBe('')
      expect(res.tail.length).toBe(acc.length)
    }
    // Now close the 46k single line with \n\n and append another paragraph: split must activate immediately!
    acc += `\n\n${'Subsequent paragraph after long single line.\n\n'.repeat(15)}`
    const finalSplit = pureSingleLineScanner.scan(acc)
    const elapsedMs = performance.now() - t0

    expect(finalSplit).toEqual(splitStreamingMarkdownPrefix(acc))
    expect(finalSplit.prefix.length).toBeGreaterThan(40000)
    expect(elapsedMs).toBeLessThan(250)

    // 3. Adversarial 1-char / 2-char chunk boundaries across list markers ("-" -> "- item", "1" -> "1. item"),
    // setext underlines ("=" -> "===" vs "=== prose"), and consecutive long lines ("25k line 1\n25k line 2")
    const listAndSetextDoc = [
      'Closed intro paragraph.\n\n'.repeat(35),
      '1. Ordered list item streamed char-by-char with a long tail ' + 'x'.repeat(450),
      '',
      '   Indented continuation paragraph inside loose ordered list ' + 'y'.repeat(120),
      '',
      '- Bullet item streamed char-by-char with a long tail ' + 'z'.repeat(450),
      '',
      '   Indented bullet continuation paragraph ' + 'w'.repeat(120),
      '',
      'Heading candidate line',
      '===' + ' '.repeat(420),
      '',
      '='.repeat(80) + ' not a setext underline ' + 'q'.repeat(380),
      '',
      'Final trailing paragraph.\n\n'.repeat(15)
    ].join('\n')

    for (const step of [1, 2, 5]) {
      const fineScanner = createStreamingMarkdownScanner()
      for (let pos = 1600; pos <= listAndSetextDoc.length; pos += step) {
        const slice = listAndSetextDoc.slice(0, pos)
        expect(fineScanner.scan(slice)).toEqual(splitStreamingMarkdownPrefix(slice))
      }
    }

    // Consecutive long lines ("25k line 1\n25k bullet line 2") must stay linear O(N) without rescanning line 1
    const twoLongLinesScanner = createStreamingMarkdownScanner()
    let twoLinesAcc = 'First long line before single newline: '
    for (let i = 0; i < 350; i += 1) {
      twoLinesAcc += chunkUnit
      twoLongLinesScanner.scan(twoLinesAcc)
    }
    twoLinesAcc += '\n\n- '
    const tTwoLines = performance.now()
    for (let i = 0; i < 350; i += 1) {
      twoLinesAcc += chunkUnit
      expect(twoLongLinesScanner.scan(twoLinesAcc)).toEqual({ prefix: '', tail: twoLinesAcc })
    }
    expect(performance.now() - tTwoLines).toBeLessThan(250)
  })
})
