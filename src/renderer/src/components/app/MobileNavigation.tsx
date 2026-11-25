import { TopView } from '@renderer/components/TopView'
import { handleMobileBack, popActiveHistoryRoute } from '@renderer/services/mobile/back'
import { mobileCommand } from '@renderer/services/mobile/runtime'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { MessageSquare, Settings } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

const isVisibleElement = (element: HTMLElement): boolean =>
  Boolean(
    element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden' &&
      getComputedStyle(element).display !== 'none'
  )

export function MobileBackHandler() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const routeRef = useRef({ pathname, navigate })
  routeRef.current = { pathname, navigate }

  useEffect(() => {
    let disposed = false
    const onBack = () => {
      if (disposed) return
      const popups = document.querySelectorAll<HTMLElement>('.ant-select-dropdown, .ant-dropdown, .ant-popover')
      if ([...popups].some(isVisibleElement)) {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        )
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return
      }
      if (document.querySelector('[data-confirm-dialog="true"]') && handleMobileBack()) return
      const confirmCancels = [
        ...document.querySelectorAll<HTMLElement>('.ant-modal-confirm-btns .ant-btn:not(.ant-btn-primary)')
      ].filter(isVisibleElement)
      if (confirmCancels.length) {
        confirmCancels.at(-1)?.click()
        return
      }
      const topPopupId = TopView.peekId()
      if ((!topPopupId || topPopupId === 'SearchPopup') && popActiveHistoryRoute()) return
      if (topPopupId?.startsWith('GeneralPopup') && handleMobileBack()) return
      if (TopView.back()) return
      const closes = [...document.querySelectorAll<HTMLElement>('.ant-modal-close, .ant-drawer-close')].filter(
        isVisibleElement
      )
      if (closes.length) {
        closes.at(-1)?.click()
        return
      }
      if (handleMobileBack()) return
      if (routeRef.current.pathname !== '/') routeRef.current.navigate('/')
      else void mobileCommand('background')
    }
    const appBackListener = onBackButtonPress(onBack).catch(() => undefined)
    const mobileBackListener = listen('mobile-back-pressed', onBack).catch(() => undefined)
    return () => {
      disposed = true
      void appBackListener.then((value) => value?.unregister()).catch(() => {})
      void mobileBackListener.then((unlisten) => unlisten?.()).catch(() => {})
    }
  }, [])
  return null
}

export default function MobileNavigation() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tabs = [
    { path: '/', label: t('mobile.chat'), icon: MessageSquare },
    { path: '/settings/provider', label: t('settings.title'), icon: Settings }
  ]
  return (
    <nav className="mobile-navigation" aria-label={t('mobile.navigation')}>
      {tabs.map(({ path, label, icon: Icon }) => (
        <button
          key={path}
          type="button"
          aria-current={
            (path.startsWith('/settings') ? pathname.startsWith('/settings') : pathname === path) ? 'page' : undefined
          }
          onClick={() => navigate(path)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
