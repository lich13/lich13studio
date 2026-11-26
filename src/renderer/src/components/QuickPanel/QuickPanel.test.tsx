// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useUserTheme', () => ({
  default: () => ({
    colorPrimary: {
      alpha: (opacity: number) => ({
        toString: () => `rgba(0, 185, 107, ${opacity})`
      })
    }
  })
}))

import { useQuickPanel } from './hook'
import { QuickPanelProvider } from './provider'
import type { QuickPanelListItem } from './types'
import { QuickPanelView } from './view'

describe('QuickPanelView', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

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
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 31
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 31
      }
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('dynamic-virtual-list')) {
        const height = Number.parseFloat(this.style.height) || 200
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
      }
      return {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function Harness({
    items,
    pageSize = 7,
    anchorRect
  }: {
    items: QuickPanelListItem[]
    pageSize?: number
    anchorRect?: DOMRect
  }) {
    const [text, setText] = useState('')
    return createElement(
      QuickPanelProvider,
      null,
      createElement(InnerHarness, { items, pageSize, text, setText, anchorRect })
    )
  }

  function InnerHarness({
    items,
    pageSize,
    text,
    setText,
    anchorRect
  }: {
    items: QuickPanelListItem[]
    pageSize: number
    text: string
    setText: React.Dispatch<React.SetStateAction<string>>
    anchorRect?: DOMRect
  }) {
    const panel = useQuickPanel()

    useEffect(() => {
      const anchor = container.querySelector('.inputbar-anchor') as HTMLElement | null
      if (anchor && anchorRect) {
        anchor.getBoundingClientRect = () => anchorRect
      }
      panel.open({
        title: 'Quick Commands',
        list: items,
        symbol: '/',
        pageSize
      })
    }, [anchorRect, items, pageSize, panel])

    return createElement(
      'div',
      { className: 'inputbar' },
      createElement(
        'div',
        { className: 'inputbar-anchor', style: { position: 'relative' } },
        createElement(QuickPanelView, { setInputText: setText }),
        createElement(
          'div',
          { id: 'inputbar' },
          createElement('textarea', {
            value: text,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)
          })
        )
      )
    )
  }

  it('matches all consecutive fuzzy items without stateful RegExp lastIndex skipping', async () => {
    const items: QuickPanelListItem[] = [
      { label: 'gpt-code-review', description: 'Review diff', action: vi.fn() },
      { label: 'gpt-code-refactor', description: 'Refactor module', action: vi.fn() },
      { label: 'gpt-code-release', description: 'Cut release', action: vi.fn() },
      { label: 'gpt-code-rollback', description: 'Rollback deploy', action: vi.fn() },
      { label: 'unrelated-entry', description: 'Skip me', action: vi.fn() }
    ]

    await act(async () => {
      root.render(createElement(Harness, { items }))
    })

    const textarea = container.querySelector('.inputbar textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.value = '/gcr'
      textarea.selectionStart = 4
      textarea.selectionEnd = 4
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      vi.advanceTimersByTime(80)
    })

    const renderedLabels = [...container.querySelectorAll('[data-id]')].map((el) => el.textContent)
    expect(renderedLabels).toHaveLength(4)
    expect(renderedLabels.join(' ')).toContain('gpt-code-review')
    expect(renderedLabels.join(' ')).toContain('gpt-code-refactor')
    expect(renderedLabels.join(' ')).toContain('gpt-code-release')
    expect(renderedLabels.join(' ')).toContain('gpt-code-rollback')
  })

  it('clamps listHeight and max-height to available visualViewport space and keeps wheel scrolling enabled', async () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        offsetTop: 20,
        height: 400,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    })

    const items: QuickPanelListItem[] = Array.from({ length: 10 }, (_, idx) => ({
      label: `Command item ${idx + 1} with an extra long title that must truncate cleanly without overlapping`,
      description: `Very long description text for command ${idx + 1} to verify ellipsis`,
      action: vi.fn()
    }))

    const anchorRect = {
      top: 150,
      bottom: 250,
      left: 0,
      right: 500,
      width: 500,
      height: 100,
      x: 0,
      y: 150,
      toJSON: () => ({})
    } as DOMRect

    await act(async () => {
      root.render(createElement(Harness, { items, pageSize: 7, anchorRect }))
    })

    const panelEl = container.querySelector('[data-testid="quick-panel"]') as HTMLElement
    const scrollerEl = container.querySelector('.dynamic-virtual-list') as HTMLElement
    expect(panelEl).toBeTruthy()
    expect(scrollerEl).toBeTruthy()
    expect(scrollerEl.style.height).toBe('77px')
    expect(scrollerEl.style.pointerEvents).not.toBe('none')
    expect(getComputedStyle(panelEl).maxHeight).toBe('122px')

    const firstRow = container.querySelector('[data-id="0"]') as HTMLElement
    expect(firstRow).toBeTruthy()
    const leftBox = firstRow.firstElementChild as HTMLElement
    const labelSpan = leftBox.lastElementChild as HTMLElement
    expect(getComputedStyle(leftBox).minWidth).toMatch(/^0(?:px)?$/)
    expect(getComputedStyle(labelSpan).minWidth).toMatch(/^0(?:px)?$/)
    expect(getComputedStyle(labelSpan).overflow).toBe('hidden')
    expect(getComputedStyle(labelSpan).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(labelSpan).whiteSpace).toBe('nowrap')
  })
})
