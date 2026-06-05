import { GithubOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  type AppReleaseInfo,
  checkLatestRelease,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL
} from '@renderer/services/appUpdate'
import { useAppDispatch } from '@renderer/store'
import {
  setNotificationSettings,
  setProxyBypassRules as _setProxyBypassRules,
  setProxyMode,
  setProxyUrl as _setProxyUrl
} from '@renderer/store/settings'
import type { AppInfo } from '@renderer/types'
import { isValidProxyUrl } from '@renderer/utils'
import { defaultByPassRules } from '@shared/config/constant'
import { Button, Input, Space, Switch, Tooltip, Typography } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    proxyUrl: storeProxyUrl,
    proxyBypassRules: storeProxyBypassRules,
    setLaunch,
    setTray,
    launchOnBoot,
    launchToTray,
    notification,
    proxyMode: storeProxyMode,
    trayOnClose
  } = useSettings()
  const [proxyUrl, setProxyUrl] = useState<string | undefined>(storeProxyUrl)
  const [proxyBypassRules, setProxyBypassRules] = useState<string | undefined>(storeProxyBypassRules)
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [releaseInfo, setReleaseInfo] = useState<AppReleaseInfo | null>(null)
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  useEffect(() => {
    void window.api
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])

  const updateLaunchOnBoot = (isLaunchOnBoot: boolean) => {
    setLaunch(isLaunchOnBoot)
  }

  const updateLaunchToTray = (isLaunchToTray: boolean) => {
    setLaunch(undefined, isLaunchToTray)
  }

  const updateTrayOnClose = (isTrayOnClose: boolean) => {
    setTray(isTrayOnClose ? true : undefined, isTrayOnClose)
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

  const openExternal = async (url: string) => {
    try {
      await window.api.shell.openExternal(url)
    } catch {
      window.toast.error(t('settings.about.openExternalFailed'))
    }
  }

  const handleCheckUpdate = async () => {
    if (releaseInfo?.hasUpdate) {
      await openExternal(releaseInfo.asset?.url || releaseInfo.releaseUrl)
      return
    }

    const currentVersion = appInfo?.version || '0.0.0'
    setCheckingUpdate(true)
    const nextReleaseInfo = await checkLatestRelease(currentVersion, appInfo?.platform)
    setReleaseInfo(nextReleaseInfo)
    setCheckingUpdate(false)

    if (nextReleaseInfo.error) {
      window.toast.error(t('settings.about.updateError'))
      return
    }

    if (nextReleaseInfo.hasUpdate) {
      window.toast.success(t('settings.about.updateAvailable', { version: nextReleaseInfo.latestVersion }))
      return
    }

    window.toast.success(t('settings.about.updateNotAvailable'))
  }

  const checkUpdateLabel = releaseInfo?.hasUpdate
    ? t('settings.about.updateTo', { version: releaseInfo.latestVersion })
    : t('settings.about.checkUpdate.label')

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
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.launch.silent_onboot')}</SettingRowTitle>
          <Switch checked={launchToTray} onChange={updateLaunchToTray} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tray.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tray.keep_background_on_close')}</SettingRowTitle>
          <Switch checked={trayOnClose} onChange={updateTrayOnClose} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.about.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.about.appVersion')}</SettingRowTitle>
          <Typography.Text type="secondary">{appInfo?.version || '-'}</Typography.Text>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.about.installType')}</SettingRowTitle>
          <Typography.Text type="secondary">
            {appInfo?.isPackaged ? t('settings.about.packaged') : t('settings.about.development')}
          </Typography.Text>
        </SettingRow>
        {releaseInfo?.hasUpdate && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.about.latestVersion')}</SettingRowTitle>
              <Typography.Text type="success">{releaseInfo.latestVersion}</Typography.Text>
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.about.github.title')}</SettingRowTitle>
          <Button size="small" icon={<GithubOutlined />} onClick={() => openExternal(GITHUB_REPO_URL)}>
            {t('settings.about.github.button')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.about.releases.title')}</SettingRowTitle>
          <Space>
            <Button size="small" onClick={() => openExternal(releaseInfo?.releaseUrl || GITHUB_RELEASES_URL)}>
              {t('settings.about.releases.button')}
            </Button>
            <Button size="small" icon={<ReloadOutlined />} loading={checkingUpdate} onClick={handleCheckUpdate}>
              {checkingUpdate ? t('settings.about.checkingUpdate') : checkUpdateLabel}
            </Button>
          </Space>
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default GeneralSettings
