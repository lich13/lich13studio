// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const scrollMocks = vi.hoisted(() => ({
  scrollElementIntoView: vi.fn()
}))

const highlightMocks = vi.hoisted(() => ({
  clearSearchHighlights: vi.fn(),
  setSearchHighlights: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(' '),
  scrollElementIntoView: scrollMocks.scrollElementIntoView
}))
vi.mock('@renderer/utils/searchHighlights', () => highlightMocks)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('div', null, children)
}))

import { ContentSearch, type ContentSearchRef } from './ContentSearch'

describe('ContentSearch streaming silentSearch & navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('preserves active match index without scroll-hijacking or double-highlighting during silentSearch', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const target = document.createElement('div')
    target.innerHTML = '<p>alpha match one</p><p>beta match two</p>'
    document.body.appendChild(target)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const searchRef: { current: ContentSearchRef | null } = { current: null }

    await act(async () => {
      root.render(
        createElement(ContentSearch, {
          ref: searchRef,
          searchTarget: target,
          filter: { acceptNode: () => NodeFilter.FILTER_ACCEPT }
        })
      )
    })

    await act(async () => {
      searchRef.current!.enable()
    })

    await act(async () => {
      const input = container.querySelector('input')!
      input.value = 'match'
      searchRef.current!.search()
    })

    expect(container.textContent).toContain('1/2')
    expect(scrollMocks.scrollElementIntoView).toHaveBeenCalledTimes(1)

    await act(async () => {
      searchRef.current!.searchNext()
    })
    expect(container.textContent).toContain('2/2')
    expect(scrollMocks.scrollElementIntoView).toHaveBeenCalledTimes(2)

    highlightMocks.setSearchHighlights.mockClear()
    scrollMocks.scrollElementIntoView.mockClear()

    // Simulate a new streaming paragraph arriving while user is inspecting match #2
    const streamed = document.createElement('p')
    streamed.textContent = 'gamma match three'
    target.appendChild(streamed)

    await act(async () => {
      searchRef.current!.silentSearch()
    })

    expect(container.textContent).toContain('2/3')
    expect(scrollMocks.scrollElementIntoView).not.toHaveBeenCalled()
    expect(highlightMocks.setSearchHighlights).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })
    target.remove()
    container.remove()
  })
})
