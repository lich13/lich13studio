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
    const matchHighlight = new Highlight()
    for (const range of ranges) {
      matchHighlight.add(range)
    }
    CSS.highlights.set('search-matches', matchHighlight)
    if (current) {
      const currentHighlight = new Highlight()
      currentHighlight.add(current)
      CSS.highlights.set('current-match', currentHighlight)
    }
  } else if (current) {
    // System WebViews before Chromium 105 have no CSS Custom Highlight API.
    // Keep search navigation working without mutating React-owned message nodes.
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(current)
    selectedRange = current
  }
}
