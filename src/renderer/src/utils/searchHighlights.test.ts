// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearSearchHighlights, setSearchHighlights } from './searchHighlights'

afterEach(() => {
  clearSearchHighlights()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
describe('search without the CSS Highlight API', () => {
  it('can initialize, clear and locate a result without changing message markup', () => {
    vi.stubGlobal('CSS', {})
    vi.stubGlobal('Highlight', undefined)
    expect(clearSearchHighlights).not.toThrow()
    const element = document.createElement('p')
    element.textContent = 'a model response'
    document.body.append(element)
    const range = document.createRange()
    range.setStart(element.firstChild!, 2)
    range.setEnd(element.firstChild!, 7)
    setSearchHighlights([range], range)
    expect(window.getSelection()?.toString()).toBe('model')
    expect(element.innerHTML).toBe('a model response')
    clearSearchHighlights()
    expect(window.getSelection()?.rangeCount).toBe(0)
  })
  it('does not clear the user selection when no fallback search selection exists', () => {
    vi.stubGlobal('CSS', {})
    document.body.textContent = 'selected text'
    const range = document.createRange()
    range.selectNodeContents(document.body)
    window.getSelection()?.addRange(range)
    clearSearchHighlights()
    expect(window.getSelection()?.toString()).toBe('selected text')
    window.getSelection()?.removeAllRanges()
  })
})
