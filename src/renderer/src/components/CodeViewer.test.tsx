// @vitest-environment jsdom
import { act, createContext, createElement, use, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  highlightCalls: [] as Array<{ code: string; language: string; theme: string; callerId: string }>
}))

const ThemeTestContext = createContext<{ theme: string; dark: boolean; preStyle?: string }>({
  theme: 'one-light',
  dark: false
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() })
  }
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    codeShowLineNumbers: true,
    fontSize: 14
  })
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => {
    const { theme, dark, preStyle } = use(ThemeTestContext)
    return useMemo(
      () => ({
        activeShikiTheme: theme,
        isShikiThemeDark: dark,
        getShikiPreProperties: async () => ({
          class: `shiki ${theme}`,
          style:
            preStyle ??
            (theme === 'one-dark'
              ? 'background-color:#282c34;color:#abb2bf'
              : 'background-color:#fafafa;color:#383a42'),
          tabindex: 0
        }),
        highlightStreamingCode: async (code: string, language: string, callerId: string) => {
          mocks.highlightCalls.push({ code, language, theme, callerId })
          const color = theme === 'one-dark' ? 'rgb(97, 175, 239)' : 'rgb(64, 120, 242)'
          return {
            lines: code.split('\n').map((line) => [{ content: line, offset: 0, color }]),
            recall: -1
          }
        },
        cleanupTokenizers: vi.fn()
      }),
      [theme, dark, preStyle]
    )
  }
}))

import CodeViewer from './CodeViewer'

describe('CodeViewer static theme switching', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.highlightCalls.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('re-highlights memoized static code blocks when activeShikiTheme changes via context', async () => {
    const viewerElement = createElement(CodeViewer, {
      value: 'const answer = 42',
      language: 'typescript',
      expanded: true,
      isStreaming: false
    })

    await act(async () => {
      root.render(
        createElement(ThemeTestContext.Provider, { value: { theme: 'one-light', dark: false } }, viewerElement)
      )
    })

    const lightToken = container.querySelector('.line-content span') as HTMLSpanElement | null
    expect(lightToken).not.toBeNull()
    expect(lightToken?.textContent).toBe('const answer = 42')
    expect(lightToken?.style.color).toBe('rgb(64, 120, 242)')
    expect(mocks.highlightCalls.map((c) => c.theme)).toEqual(['one-light'])

    // Switch theme through context while keeping the exact same CodeViewer props/element
    await act(async () => {
      root.render(createElement(ThemeTestContext.Provider, { value: { theme: 'one-dark', dark: true } }, viewerElement))
    })

    const darkToken = container.querySelector('.line-content span') as HTMLSpanElement | null
    expect(darkToken).not.toBeNull()
    expect(darkToken?.textContent).toBe('const answer = 42')
    expect(darkToken?.style.color).toBe('rgb(97, 175, 239)')
    expect(darkToken?.style.opacity).not.toBe('0.35')
    const wrapper = container.querySelector('.code-viewer') as HTMLDivElement | null
    expect(wrapper?.style.backgroundColor).toBe('rgb(40, 44, 52)')
    expect(mocks.highlightCalls.map((c) => c.theme)).toEqual(['one-light', 'one-dark'])

    // Switching to a fallback theme with empty style clears stale inline background-color cleanly
    await act(async () => {
      root.render(
        createElement(
          ThemeTestContext.Provider,
          { value: { theme: 'fallback-plain', dark: false, preStyle: '' } },
          viewerElement
        )
      )
    })
    expect(wrapper?.style.backgroundColor).toBe('')
  })

  it('re-highlights collapsed virtualized CodeViewer (expanded=false) and preserves container height across theme switches', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return 480
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('shiki-scroller') ? Number.parseFloat(this.style.height) || 160 : 22
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('shiki-scroller') ? Number.parseFloat(this.style.height) || 160 : 22
      }
    })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const height = this.classList.contains('shiki-scroller') ? Number.parseFloat(this.style.height) || 160 : 22
      return {
        top: 0,
        bottom: height,
        left: 0,
        right: 480,
        width: 480,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    })

    const collapsedElement = createElement(CodeViewer, {
      value: 'line 1\nline 2\nline 3',
      language: 'typescript',
      expanded: false,
      height: 160,
      isStreaming: false
    })

    try {
      await act(async () => {
        root.render(
          createElement(ThemeTestContext.Provider, { value: { theme: 'one-light', dark: false } }, collapsedElement)
        )
      })

      const wrapper = container.querySelector('.code-viewer') as HTMLDivElement | null
      expect(wrapper?.style.height).toBe('160px')
      expect(wrapper?.style.backgroundColor).toBe('rgb(250, 250, 250)')
      const firstLightToken = container.querySelector('.line-content span') as HTMLSpanElement | null
      expect(firstLightToken?.style.color).toBe('rgb(64, 120, 242)')

      await act(async () => {
        root.render(
          createElement(ThemeTestContext.Provider, { value: { theme: 'one-dark', dark: true } }, collapsedElement)
        )
      })

      expect(wrapper?.style.height).toBe('160px')
      expect(wrapper?.style.backgroundColor).toBe('rgb(40, 44, 52)')
      const firstDarkToken = container.querySelector('.line-content span') as HTMLSpanElement | null
      expect(firstDarkToken?.style.color).toBe('rgb(97, 175, 239)')
      expect(firstDarkToken?.style.opacity).not.toBe('0.35')
    } finally {
      rectSpy.mockRestore()
      if (origOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
      if (origOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
      if (origClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClientHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
    }
  })
})
