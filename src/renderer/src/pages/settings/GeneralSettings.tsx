import { InfoCircleOutlined } from '@ant-design/icons'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import {
  setNotificationSettings,
  setProxyBypassRules as _setProxyBypassRules,
  setProxyMode,
  setProxyUrl as _setProxyUrl
} from '@renderer/store/settings'
import { isValidProxyUrl } from '@renderer/utils'
import { defaultByPassRules } from '@shared/config/constant'
import { Input, Switch, Tooltip } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    proxyUrl: storeProxyUrl,
    proxyBypassRules: storeProxyBypassRules,
    setLaunch,
    launchOnBoot,
    notification,
    proxyMode: storeProxyMode
  } = useSettings()
  const [proxyUrl, setProxyUrl] = useState<string | undefined>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string | undefined>(storeProxyBypassRules)
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const updateLaunchOnBoot = (isLaunchOnBoot: boolean) => {
    setLaunch(isLaunchOnBoot)
  }

  const onSetProxyUrl = () => {
    if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
      window.toast.error(t('message.error.invalid.proxy.url'))
      return
    }

    dispatch(_setProxyUrl(proxyUrl))
  }

  const onSetProxyBypassRules = () => {
    dispatch(_setProxyBypassRules(proxyBypassRules))
  }

  const proxyModeOptions: { value: 'system' | 'custom' | 'none'; label: string }[] = [
    { value: 'system', label: t('settings.proxy.mode.system') },
    { value: 'custom', label: t('settings.proxy.mode.custom') },
    { value: 'none', label: t('settings.proxy.mode.none') }
  ]

  const onProxyModeChange = (mode: 'system' | 'custom' | 'none') => {
    dispatch(setProxyMode(mode))
  }

  const handleNotificationChange = (value: boolean) => {
    dispatch(setNotificationSettings({ assistant: value, backup: false }))
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.proxy.mode.title')}</SettingRowTitle>
          <Selector value={storeProxyMode} onChange={onProxyModeChange} options={proxyModeOptions} />
        </SettingRow>
        {storeProxyMode === 'custom' && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.proxy.address')}</SettingRowTitle>
              <Input
                spellCheck={false}
                placeholder="socks5://127.0.0.1:6153"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                style={{ width: 180 }}
                onBlur={onSetProxyUrl}
                type="url"
              />
            </SettingRow>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{t('settings.proxy.bypass')}</span>
                <Tooltip title={t('settings.proxy.tip')} placement="right">
                  <InfoCircleOutlined style={{ cursor: 'pointer' }} />
                </Tooltip>
              </SettingRowTitle>
              <Input
                spellCheck={false}
                placeholder={defaultByPassRules}
                value={proxyBypassRules}
                onChange={(e) => setProxyBypassRules(e.target.value)}
                style={{ width: 180 }}
                onBlur={onSetProxyBypassRules}
              />
            </SettingRow>
          </>
        )}
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.assistant')}</SettingRowTitle>
          <Switch checked={notification.assistant} onChange={handleNotificationChange} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.launch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.onboot')}</SettingRowTitle>
          <Switch checked={launchOnBoot} onChange={updateLaunchOnBoot} />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
