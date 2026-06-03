import { describe, expect, it } from 'vitest'

import { isComposingInputEvent } from './input'

describe('input keyboard helpers', () => {
  it('detects IME composition from React nativeEvent.isComposing', () => {
    expect(
      isComposingInputEvent({
        nativeEvent: { isComposing: true }
      })
    ).toBe(true)
  })

  it('detects IME composition from top-level isComposing', () => {
    expect(
      isComposingInputEvent({
        isComposing: true,
        nativeEvent: { isComposing: false }
      })
    ).toBe(true)
  })

  it('detects IME composition from keyCode 229', () => {
    expect(
      isComposingInputEvent({
        keyCode: 229,
        nativeEvent: { keyCode: 229 }
      })
    ).toBe(true)
  })

  it('detects IME composition from Process key code', () => {
    expect(
      isComposingInputEvent({
        code: 'Process',
        nativeEvent: { code: 'Process' }
      })
    ).toBe(true)
  })

  it('does not treat a normal Enter press as composing', () => {
    expect(
      isComposingInputEvent({
        key: 'Enter',
        keyCode: 13,
        nativeEvent: { isComposing: false, keyCode: 13 }
      })
    ).toBe(false)
  })
})
