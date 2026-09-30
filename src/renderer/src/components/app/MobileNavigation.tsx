import { handleMobileBack } from '@renderer/services/mobile/back'
import { mobileCommand } from '@renderer/services/mobile/runtime'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { FlaskConical, MessageSquare, Settings } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

export default function MobileNavigation() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const listener = onBackButtonPress(() => {
      const popups = document.querySelectorAll<HTMLElement>('.ant-select-dropdown, .ant-dropdown, .ant-popover')
      if (
        [...popups].some(
          (element) =>
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
        )
      ) {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        )
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return
      }
      const closes = [...document.querySelectorAll<HTMLElement>('.ant-modal-close, .ant-drawer-close')].filter(
        (element) => element.getClientRects().length
      )
      if (closes.length) {
        closes.at(-1)?.click()
        return
      }
      if (handleMobileBack()) return
      if (pathname !== '/') navigate('/')
      else void mobileCommand('background')
    })
    return () => {
      void listener.then((value) => value.unregister()).catch(() => {})
    }
  }, [pathname, navigate])
  const tabs = [
    { path: '/', label: t('mobile.chat'), icon: MessageSquare },
    { path: '/model-test', label: t('mobile.test'), icon: FlaskConical },
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
