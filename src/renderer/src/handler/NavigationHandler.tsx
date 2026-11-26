import { useNotification } from '@renderer/context/NotificationProvider'
import { consumeDesktopCredentialResetNotice } from '@renderer/services/mobile/credentials'
import store, { useAppSelector } from '@renderer/store'
import { Button, Space } from 'antd'
import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

const RESET_NOTICE_KEY = 'desktop-credential-reset'

const NavigationHandler: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const notification = useNotification()
  const showSettingsShortcutEnabled = useAppSelector(
    (state) => state.shortcuts.shortcuts.find((s) => s.key === 'show_settings')?.enabled
  )

  useEffect(() => {
    const notice = consumeDesktopCredentialResetNotice()
    if (!notice) return

    const affectedItems: string[] = []
    for (const item of notice.providers) {
      const fields: string[] = []
      if (item.apiKey) fields.push(t('settings.provider.keychain_migrated.field_api_key'))
      if (item.extraHeaders) fields.push(t('settings.provider.keychain_migrated.field_extra_headers'))
      affectedItems.push(`${item.name} (${fields.join(' / ')})`)
    }
    if (notice.webdav) {
      affectedItems.push(t('settings.provider.keychain_migrated.field_webdav'))
    }

    const firstProvider = notice.providers[0]
    const firstHeaderProvider = notice.providers.find((item) => item.extraHeaders)

    notification.open({
      key: RESET_NOTICE_KEY,
      type: 'warning',
      duration: 0,
      placement: 'topRight',
      message: t('settings.provider.keychain_migrated.title'),
      description: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            {t('settings.provider.keychain_migrated.description', {
              items: affectedItems.join(', ') || String(notice.clearedCount)
            })}
          </div>
          <Space size={8} wrap>
            {firstProvider && (
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  notification.destroy(RESET_NOTICE_KEY)
                  navigate(`/settings/provider?id=${encodeURIComponent(firstProvider.id)}`)
                }}>
                {t('settings.provider.keychain_migrated.action_provider')}
              </Button>
            )}
            {firstHeaderProvider && (
              <Button
                size="small"
                onClick={() => {
                  notification.destroy(RESET_NOTICE_KEY)
                  navigate(`/settings/provider?id=${encodeURIComponent(firstHeaderProvider.id)}`)
                  const liveProvider = store
                    .getState()
                    .llm.providers.find((provider) => provider.id === firstHeaderProvider.id)
                  if (liveProvider) {
                    void import('@renderer/pages/settings/ProviderSettings/CustomHeaderPopup').then(
                      ({ default: CustomHeaderPopup }) =>
                        CustomHeaderPopup.show({ provider: { ...liveProvider, models: [] } })
                    )
                  }
                }}>
                {t('settings.provider.keychain_migrated.action_headers')}
              </Button>
            )}
            <Button
              size="small"
              onClick={() => {
                notification.destroy(RESET_NOTICE_KEY)
                navigate('/settings/data')
              }}>
              {t('settings.provider.keychain_migrated.action_backup')}
            </Button>
          </Space>
        </div>
      )
    })
  }, [navigate, notification, t])

  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      if (location.pathname.startsWith('/settings')) {
        return
      }
      navigate('/settings/provider')
    },
    {
      splitKey: '!',
      enableOnContentEditable: true,
      enableOnFormTags: true,
      enabled: showSettingsShortcutEnabled
    }
  )

  return null
}

export default NavigationHandler
