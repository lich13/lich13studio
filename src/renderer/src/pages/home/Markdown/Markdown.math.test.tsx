// @vitest-environment jsdom
import { type MainTextMessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const codeBlockSpy = vi.fn(({ children, className }: any) =>
  createElement('code', { 'data-testid': 'code-block', className }, children)
)

const mockSettings = {
  mathEngine: 'KaTeX' as string,
  mathEnableSingleDollar: true
}

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mockSettings
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: (props: any) => createElement('img', props)
}))

vi.mock('@renderer/components/MarkdownShadowDOMRenderer', () => ({
  default: (props: any) => createElement('style', props)
}))

vi.mock('./CodeBlock', () => ({
  default: (props: any) => codeBlockSpy(props)
}))

vi.mock('./Link', () => ({
  default: (props: any) => createElement('a', props)
}))

vi.mock('./MarkdownSvgRenderer', () => ({
  default: (props: any) => createElement('svg', props)
}))

vi.mock('./Table', () => ({
  default: (props: any) => createElement('table', props)
}))

import Markdown from './Markdown'

function makeBlock(id: string, content: string): MainTextMessageBlock {
  return {
    id,
    messageId: `msg-${id}`,
    type: MessageBlockType.MAIN_TEXT,
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS
  }
}

describe('Markdown lazy KaTeX hydration & fenced math compatibility', () => {
  afterEach(() => {
    codeBlockSpy.mockClear()
    vi.unstubAllGlobals()
  })

  it('never renders language-math CodeBlock during initial KaTeX load and hydrates inline, mhchem, and fenced math', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Markdown, { block: makeBlock('1', 'Inline $x^2 + y^2$ and \\ce{H2O}') }))
    })

    // Initial synchronous render before dynamic import resolves must NOT emit language-math CodeBlock
    const languageMathCalls = codeBlockSpy.mock.calls.filter(([props]) =>
      String(props?.className || '').includes('language-math')
    )
    expect(languageMathCalls).toHaveLength(0)

    // Wait for dynamic KaTeX + mhchem import to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })

    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1)
    expect(
      codeBlockSpy.mock.calls.filter(([props]) => String(props?.className || '').includes('language-math'))
    ).toHaveLength(0)

    // Fenced ```math block without any '$' character must also trigger KaTeX rendering
    await act(async () => {
      root.render(createElement(Markdown, { block: makeBlock('2', '```math\n\\int_0^1 x\\,dx = \\frac{1}{2}\n```') }))
    })

    expect(container.querySelectorAll('.katex-display').length).toBe(1)

    // Legacy MathJax configuration gracefully maps to KaTeX
    mockSettings.mathEngine = 'MathJax'
    await act(async () => {
      root.render(createElement(Markdown, { block: makeBlock('3', 'Legacy $a + b = c$') }))
    })
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1)
    mockSettings.mathEngine = 'KaTeX'

    await act(async () => {
      root.unmount()
    })
  })
})
