let selectedRange: Range | undefined

export function clearSearchHighlights() {
  globalThis.CSS?.highlights?.clear()
  if (selectedRange) {
    const selection = window.getSelection()
    if (selection?.rangeCount && selection.getRangeAt(0) === selectedRange) selection.removeAllRanges()
    selectedRange = undefined
  }
}

export function setSearchHighlights(ranges: Range[], current?: Range) {
  clearSearchHighlights()
  if (globalThis.CSS?.highlights && typeof Highlight !== 'undefined') {
    CSS.highlights.set('search-matches', new Highlight(...ranges))
    if (current) CSS.highlights.set('current-match', new Highlight(current))
  } else if (current) {
    // System WebViews before Chromium 105 have no CSS Custom Highlight API.
    // Keep search navigation working without mutating React-owned message nodes.
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(current)
    selectedRange = current
  }
}
