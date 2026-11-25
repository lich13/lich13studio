// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appBackHandlers: [] as Array<() => void>,
  appBackUnregister: vi.fn(),
  mobileBackHandlers: [] as Array<() => void>,
  mobileBackUnlisten: vi.fn(),
  rejectRegistrations: false,
  mobileCommand: vi.fn(async () => ({}))
}))

vi.mock('@tauri-apps/api/app', () => ({
  onBackButtonPress: vi.fn(async (handler: () => void) => {
    if (mocks.rejectRegistrations) throw new Error('unavailable')
    mocks.appBackHandlers.push(handler)
    return { unregister: mocks.appBackUnregister }
  })
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    if (mocks.rejectRegistrations) throw new Error('unavailable')
    if (event === 'mobile-back-pressed') {
      mocks.mobileBackHandlers.push(handler)
    }
    return mocks.mobileBackUnlisten
  })
}))

vi.mock('@renderer/services/mobile/runtime', () => ({
  mobileCommand: (...args: any[]) => mocks.mobileCommand(...args)
}))

vi.mock('@renderer/hooks/useAppInit', () => ({ useAppInit: () => {} }))
vi.mock('@renderer/hooks/useShortcuts', () => ({ useShortcuts: () => ({ shortcuts: [] }) }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key })
}))

import ConfirmDialog from '@renderer/components/ConfirmDialog'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import TopViewContainer, { TopView } from '@renderer/components/TopView'
import { useMobileBack } from '@renderer/services/mobile/back'

import { MobileBackHandler } from './MobileNavigation'

function RouteController({ onNavigateRef }: { onNavigateRef: (nav: ReturnType<typeof useNavigate>) => void }) {
  const navigate = useNavigate()
  onNavigateRef(navigate)
  return null
}

describe('MobileBackHandler', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.appBackHandlers.length = 0
    mocks.mobileBackHandlers.length = 0
    mocks.appBackUnregister.mockClear()
    mocks.mobileBackUnlisten.mockClear()
    mocks.rejectRegistrations = false
    mocks.mobileCommand.mockClear()
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
  })

  it('handles native mobile-back-pressed on recreated activities without listener churn across routes', async () => {
    let navigateFn!: ReturnType<typeof useNavigate>

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings/provider']}>
          <TopViewContainer>
            <MobileBackHandler />
            <RouteController onNavigateRef={(nav) => (navigateFn = nav)} />
          </TopViewContainer>
        </MemoryRouter>
      )
    })

    expect(mocks.appBackHandlers).toHaveLength(1)
    expect(mocks.mobileBackHandlers).toHaveLength(1)

    const onCancel = vi.fn(() => TopView.hide('CCSImport-1'))
    act(() => {
      TopView.show(<div data-testid="import-modal">import</div>, 'CCSImport-1', onCancel)
    })
    expect(TopView.peekId()).toBe('CCSImport-1')

    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(TopView.peekId()).toBeUndefined()
    expect(mocks.mobileCommand).not.toHaveBeenCalled()

    // Second back press navigates from /settings/provider to / without re-subscribing listeners.
    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(mocks.appBackHandlers).toHaveLength(1)
    expect(mocks.mobileBackHandlers).toHaveLength(1)
    expect(mocks.appBackUnregister).not.toHaveBeenCalled()
    expect(mocks.mobileBackUnlisten).not.toHaveBeenCalled()
    expect(mocks.mobileCommand).not.toHaveBeenCalled()

    // Third back press at root backgrounds the task.
    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(mocks.mobileCommand).toHaveBeenCalledTimes(1)
    expect(mocks.mobileCommand).toHaveBeenCalledWith('background')

    // Navigating again keeps the single subscription active until unmount.
    act(() => {
      navigateFn('/settings/provider')
    })
    expect(mocks.appBackHandlers).toHaveLength(1)
    expect(mocks.mobileBackHandlers).toHaveLength(1)

    await act(async () => {
      root.unmount()
    })
    expect(mocks.appBackUnregister).toHaveBeenCalledTimes(1)
    expect(mocks.mobileBackUnlisten).toHaveBeenCalledTimes(1)

    // Late callback invocations after unmount are ignored.
    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(mocks.mobileCommand).toHaveBeenCalledTimes(1)
  })

  it('handles popup dismissal via onBackButtonPress and tolerates missing Tauri listeners', async () => {
    const dropdown = document.createElement('div')
    dropdown.className = 'ant-select-dropdown'
    vi.spyOn(dropdown, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 80)] as unknown as DOMRectList)
    document.body.appendChild(dropdown)

    const escapeSpy = vi.fn()
    document.body.addEventListener('keydown', escapeSpy)

    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/']}>
            <MobileBackHandler />
          </MemoryRouter>
        )
      })

      act(() => {
        mocks.appBackHandlers[0]()
      })
      expect(escapeSpy).toHaveBeenCalledTimes(1)
      expect(mocks.mobileCommand).not.toHaveBeenCalled()

      await act(async () => {
        root.unmount()
      })

      // Re-mount when Tauri bridge rejects listener registration: must not produce unhandled rejections.
      mocks.rejectRegistrations = true
      root = createRoot(container)
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/']}>
            <MobileBackHandler />
          </MemoryRouter>
        )
      })
    } finally {
      document.body.removeEventListener('keydown', escapeSpy)
      dropdown.remove()
    }
  })

  it('cancels ConfirmDialog and unwinds nested useMobileBack inside GeneralPopup-<n> before backgrounding', async () => {
    let confirmOpen = true
    const onConfirmCancel = vi.fn(() => {
      confirmOpen = false
    })
    const onInnerBack = vi.fn()

    function InnerPopupView({ detailOpen }: { detailOpen: boolean }) {
      useMobileBack(detailOpen, onInnerBack)
      return <div>inner</div>
    }

    function Harness({ showConfirm }: { showConfirm: boolean }) {
      return (
        <MemoryRouter initialEntries={['/']}>
          <TopViewContainer>
            <MobileBackHandler />
            {showConfirm && (
              <ConfirmDialog x={40} y={40} message="Delete file?" onConfirm={vi.fn()} onCancel={onConfirmCancel} />
            )}
          </TopViewContainer>
        </MemoryRouter>
      )
    }

    await act(async () => {
      root.render(<Harness showConfirm={confirmOpen} />)
    })

    // Pressing Android Back while ConfirmDialog is open cancels ConfirmDialog instead of backgrounding
    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(onConfirmCancel).toHaveBeenCalledTimes(1)
    expect(mocks.mobileCommand).not.toHaveBeenCalled()

    await act(async () => {
      root.render(<Harness showConfirm={false} />)
    })

    // Open GeneralPopup (now GeneralPopup-<n>) with an inner useMobileBack registration
    let popupResolved = false
    await act(async () => {
      void GeneralPopup.show({ content: <InnerPopupView detailOpen={true} /> }).then(() => {
        popupResolved = true
      })
    })
    expect(TopView.peekId()).toMatch(/^GeneralPopup-\d+$/)

    // First Back triggers inner useMobileBack without closing GeneralPopup
    act(() => {
      mocks.mobileBackHandlers[0]()
    })
    expect(onInnerBack).toHaveBeenCalledTimes(1)
    expect(popupResolved).toBe(false)
    expect(TopView.peekId()).toMatch(/^GeneralPopup-\d+$/)

    // When inner detail closes, next Back dismisses GeneralPopup and resolves its Promise
    TopView.clear()
    await act(async () => {
      void GeneralPopup.show({ content: <InnerPopupView detailOpen={false} /> }).then(() => {
        popupResolved = true
      })
    })
    await act(async () => {
      mocks.mobileBackHandlers[0]()
      await Promise.resolve()
    })
    expect(popupResolved).toBe(true)
    expect(TopView.peekId()).toBeUndefined()
    expect(mocks.mobileCommand).not.toHaveBeenCalled()
  })
})
