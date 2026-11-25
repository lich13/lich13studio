// @vitest-environment jsdom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useHotkeys } from 'react-hotkeys-hook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enableQuitFullScreen: true,
  setFullScreen: vi.fn(async () => {})
}))

vi.mock('@renderer/hooks/useAppInit', () => ({ useAppInit: () => {} }))
vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcuts: () => ({
    shortcuts: [{ key: 'exit_fullscreen', enabled: mocks.enableQuitFullScreen }]
  })
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/pages/home/Messages/NarrowLayout', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

import { handleMobileBack } from '@renderer/services/mobile/back'

import ConfirmDialog from '../ConfirmDialog'
import { ContentSearch, type ContentSearchRef } from '../ContentSearch'
import GeneralPopup from '../Popups/GeneralPopup'
import TopViewContainer, { TopView } from './index'

function dispatchEscape(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init
  })
  target.dispatchEvent(event)
  return event
}

describe('TopViewContainer Escape fullscreen guard', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const extraNodes: HTMLElement[] = []

  const appendBodyNode = (html: string): HTMLElement => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const node = wrapper.firstElementChild as HTMLElement
    document.body.appendChild(node)
    extraNodes.push(node)
    return node
  }

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.enableQuitFullScreen = true
    mocks.setFullScreen.mockClear()
    ;(window as any).api = {
      ...(window as any).api,
      setFullScreen: mocks.setFullScreen
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      TopView.clear()
      root.unmount()
    })
    container.remove()
    for (const node of extraNodes.splice(0)) {
      node.remove()
    }
  })

  it('exits fullscreen on plain Escape only when enabled and unobstructed', () => {
    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
    expect(mocks.setFullScreen).toHaveBeenCalledWith(false)

    mocks.setFullScreen.mockClear()
    dispatchEscape(document.body, { shiftKey: true })
    dispatchEscape(document.body, { ctrlKey: true })
    dispatchEscape(document.body, { altKey: true })
    dispatchEscape(document.body, { metaKey: true })
    dispatchEscape(document.body, { isComposing: true })
    const imeEvent = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true, cancelable: true })
    document.body.dispatchEvent(imeEvent)
    expect(mocks.setFullScreen).not.toHaveBeenCalled()

    mocks.enableQuitFullScreen = false
    act(() => {
      root.render(
        <TopViewContainer>
          <span />
        </TopViewContainer>
      )
    })
    dispatchEscape()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
  })

  it('does not exit fullscreen when defaultPrevented is set by a target listener', () => {
    const input = document.createElement('input')
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
      }
    })
    document.body.appendChild(input)
    extraNodes.push(input)

    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    dispatchEscape(input)
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
  })

  it('does not exit fullscreen when dismissing a TopView popup on the same Escape event', () => {
    function DismissiblePopup() {
      useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            TopView.hide('test-popup')
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [])
      return <div data-testid="popup">popup</div>
    }

    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    act(() => {
      TopView.show(DismissiblePopup, 'test-popup')
    })
    expect(TopView.peekId()).toBe('test-popup')

    act(() => {
      dispatchEscape()
    })
    expect(TopView.peekId()).toBeUndefined()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()

    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
  })

  it.each([
    '<div class="ant-modal-wrap"><div class="ant-modal">modal</div></div>',
    '<div class="ant-drawer ant-drawer-open"><div class="ant-drawer-content-wrapper">drawer</div></div>',
    '<div class="ant-select-dropdown">select</div>',
    '<div class="ant-dropdown">dropdown</div>',
    '<div class="ant-popover">popover</div>',
    '<div class="ant-image-preview-wrap">preview</div>'
  ])('blocks fullscreen exit while visible overlay %s is open', (markup) => {
    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    const overlay = appendBodyNode(markup)
    dispatchEscape()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()

    overlay.remove()
    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
  })

  it('ignores hidden cached Ant Design overlays so Escape still exits fullscreen', () => {
    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    appendBodyNode('<div class="ant-modal-wrap" style="display: none"><div class="ant-modal">closed</div></div>')
    appendBodyNode(
      '<div class="ant-drawer"><div class="ant-drawer-content-wrapper ant-drawer-content-wrapper-hidden">closed</div></div>'
    )
    appendBodyNode('<div class="ant-select-dropdown ant-select-dropdown-hidden">closed</div>')
    appendBodyNode('<div class="ant-dropdown ant-dropdown-hidden">closed</div>')
    appendBodyNode('<div class="ant-popover ant-popover-hidden">closed</div>')
    appendBodyNode('<div class="ant-image-preview-wrap" aria-hidden="true">closed</div>')
    appendBodyNode('<dialog role="dialog">closed dialog</dialog>')

    expect(TopView.hasOpenOverlay()).toBe(false)
    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
  })

  it('cancels ConfirmDialog portal on plain Escape without exiting fullscreen and ignores IME composition', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    function Host({ open }: { open: boolean }) {
      return (
        <TopViewContainer>
          {open && <ConfirmDialog x={100} y={100} message="Delete?" onConfirm={onConfirm} onCancel={onCancel} />}
        </TopViewContainer>
      )
    }

    act(() => {
      root.render(<Host open={true} />)
    })
    expect(TopView.hasOpenOverlay()).toBe(true)

    dispatchEscape(document.body, { isComposing: true })
    expect(onCancel).not.toHaveBeenCalled()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()

    act(() => {
      dispatchEscape()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(mocks.setFullScreen).not.toHaveBeenCalled()

    act(() => {
      root.render(<Host open={false} />)
    })
    expect(TopView.hasOpenOverlay()).toBe(false)
    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
  })

  it('uses client rects when layout metrics are available so zero-rect overlays do not block Escape', () => {
    const docRectSpy = vi
      .spyOn(document.documentElement, 'getClientRects')
      .mockReturnValue([new DOMRect(0, 0, 1280, 800)] as unknown as DOMRectList)

    try {
      act(() => {
        root.render(
          <TopViewContainer>
            <div />
          </TopViewContainer>
        )
      })

      const modal = appendBodyNode('<div class="ant-modal">modal</div>')
      vi.spyOn(modal, 'getClientRects').mockReturnValue([] as unknown as DOMRectList)

      dispatchEscape()
      expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)

      mocks.setFullScreen.mockClear()
      vi.spyOn(modal, 'getClientRects').mockReturnValue([new DOMRect(10, 10, 400, 300)] as unknown as DOMRectList)

      dispatchEscape()
      expect(mocks.setFullScreen).not.toHaveBeenCalled()
    } finally {
      docRectSpy.mockRestore()
    }
  })

  it('closes ContentSearch via document hotkey without exiting fullscreen and preserves it behind open overlays', () => {
    let searchRef!: React.RefObject<ContentSearchRef | null>

    function ChatWithSearch() {
      const targetRef = useRef<HTMLDivElement>(null)
      searchRef = useRef<ContentSearchRef>(null)
      useHotkeys('esc', (event) => {
        if (!TopView.hasOpenOverlay() && searchRef.current?.disable()) {
          event.preventDefault()
        }
      })
      return (
        <TopViewContainer>
          <div ref={targetRef}>message body</div>
          <ContentSearch ref={searchRef} searchTarget={targetRef} filter={{ acceptNode: () => 1 }} />
        </TopViewContainer>
      )
    }

    act(() => {
      root.render(<ChatWithSearch />)
    })
    act(() => {
      searchRef.current?.enable()
    })

    // While a modal overlay is open above ContentSearch, Escape neither exits fullscreen nor disables ContentSearch.
    const modal = appendBodyNode('<div class="ant-modal-wrap"><div class="ant-modal">modal</div></div>')
    dispatchEscape()
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
    modal.remove()

    // Once modal is gone, first Escape closes ContentSearch (even when focus is outside its input) without exiting fullscreen.
    act(() => {
      dispatchEscape()
    })
    expect(mocks.setFullScreen).not.toHaveBeenCalled()
    expect(searchRef.current?.disable()).toBe(false)

    // Subsequent Escape with ContentSearch already closed exits fullscreen.
    dispatchEscape()
    expect(mocks.setFullScreen).toHaveBeenCalledTimes(1)
  })

  it('settles replaced entry cleanly on duplicate TopView.show ID and assigns unique IDs to GeneralPopup.show', async () => {
    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    let firstOutcome = 'pending'
    let secondOutcome = 'pending'
    await act(async () => {
      const p1 = new Promise<string>((resolve) => {
        TopView.show(<div id="dup-popup-1">first</div>, 'DupId', () => {
          TopView.hide('DupId')
          resolve('cancelled-1')
        })
      })
      void p1.then((v) => {
        firstOutcome = v
      })
    })
    expect(container.querySelector('#dup-popup-1')).not.toBeNull()

    await act(async () => {
      const p2 = new Promise<string>((resolve) => {
        TopView.show(<div id="dup-popup-2">second</div>, 'DupId', () => {
          TopView.hide('DupId')
          resolve('cancelled-2')
        })
      })
      void p2.then((v) => {
        secondOutcome = v
      })
    })

    // First caller's Promise was settled immediately on replacement, and second element is mounted cleanly
    expect(firstOutcome).toBe('cancelled-1')
    expect(secondOutcome).toBe('pending')
    expect(container.querySelector('#dup-popup-1')).toBeNull()
    expect(container.querySelector('#dup-popup-2')).not.toBeNull()

    await act(async () => {
      expect(TopView.back()).toBe(true)
      await Promise.resolve()
    })
    expect(secondOutcome).toBe('cancelled-2')
    expect(container.querySelector('#dup-popup-2')).toBeNull()

    // Concurrent GeneralPopup.show calls get distinct GeneralPopup-<n> IDs and resolve both Promises
    let gp1Done = false
    let gp2Done = false
    await act(async () => {
      void GeneralPopup.show({ content: <div id="gp-one">one</div> }).then(() => {
        gp1Done = true
      })
      void GeneralPopup.show({ content: <div id="gp-two">two</div> }).then(() => {
        gp2Done = true
      })
    })
    expect(TopView.peekId()).toMatch(/^GeneralPopup-\d+$/)

    await act(async () => {
      expect(TopView.back()).toBe(true)
      await Promise.resolve()
    })
    expect(gp2Done).toBe(true)
    expect(gp1Done).toBe(false)
    expect(TopView.peekId()).toMatch(/^GeneralPopup-\d+$/)

    await act(async () => {
      expect(TopView.back()).toBe(true)
      await Promise.resolve()
    })
    expect(gp1Done).toBe(true)
    expect(TopView.peekId()).toBeUndefined()

    // TopView.back() when onCancel synchronously opens a follow-up popup with the same ID must keep the replacement alive
    let followUpOutcome = 'pending'
    await act(async () => {
      TopView.show(<div id="step-1">step 1</div>, 'WizardPopup', () => {
        TopView.hide('WizardPopup')
        TopView.show(<div id="step-2">step 2</div>, 'WizardPopup', () => {
          TopView.hide('WizardPopup')
          followUpOutcome = 'closed-step-2'
        })
      })
    })
    await act(async () => {
      expect(TopView.back()).toBe(true)
    })
    expect(container.querySelector('#step-1')).toBeNull()
    expect(container.querySelector('#step-2')).not.toBeNull()
    expect(TopView.peekId()).toBe('WizardPopup')
    expect(followUpOutcome).toBe('pending')

    await act(async () => {
      expect(TopView.back()).toBe(true)
    })
    expect(followUpOutcome).toBe('closed-step-2')
    expect(TopView.peekId()).toBeUndefined()

    // GeneralPopup.show preserves internal close + Promise settlement even when caller passes custom onCancel/afterClose
    const userOnCancel = vi.fn()
    const userAfterClose = vi.fn()
    let customGpResolved = false
    await act(async () => {
      void GeneralPopup.show({
        content: <div id="gp-custom">custom</div>,
        onCancel: userOnCancel,
        afterClose: userAfterClose,
        transitionName: ''
      }).then(() => {
        customGpResolved = true
      })
    })
    await act(async () => {
      document.querySelector<HTMLElement>('.ant-modal-close')?.click()
      await Promise.resolve()
    })
    expect(userOnCancel).toHaveBeenCalledTimes(1)
    expect(userAfterClose).toHaveBeenCalledTimes(1)
    expect(customGpResolved).toBe(true)
    expect(TopView.peekId()).toBeUndefined()
  })

  it('registers ConfirmDialog with Android mobile back stack and cleans up on unmount', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    act(() => {
      root.render(
        <TopViewContainer>
          <ConfirmDialog x={80} y={80} message="Confirm?" onConfirm={onConfirm} onCancel={onCancel} />
        </TopViewContainer>
      )
    })

    expect(handleMobileBack()).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    act(() => {
      root.render(
        <TopViewContainer>
          <div />
        </TopViewContainer>
      )
    })

    expect(handleMobileBack()).toBe(false)
  })
})
