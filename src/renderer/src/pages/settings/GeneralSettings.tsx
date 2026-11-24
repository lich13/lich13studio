import { GithubOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  type AppReleaseInfo,
  checkLatestRelease,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL
} from '@renderer/services/appUpdate'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { useAppDispatch } from '@renderer/store'
import { setNotificationSettings } from '@renderer/store/settings'
import type { AppInfo } from '@renderer/types'
import { Button, Space, Switch, Typography } from 'antd'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const GeneralSettings: FC = () => {
  const {
    setLaunch,
    setAutoCheckUpdate,
    setTray,
    autoCheckUpdate,
    launchOnBoot,
    launchToTray,
    notification,
    trayOnClose
  } = useSettings()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const updateInFlight = useRef(false)
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

  const updateAutoCheckUpdate = (isAutoCheckUpdate: boolean) => {
    setAutoCheckUpdate(isAutoCheckUpdate)
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
    if (updateInFlight.current) return
    updateInFlight.current = true
    setCheckingUpdate(true)
    try {
      if (releaseInfo?.hasUpdate) {
        await openExternal(releaseInfo.releaseUrl)
        return
      }
      const currentVersion = appInfo?.version || '0.0.0'
      const nextReleaseInfo = await checkLatestRelease(currentVersion, appInfo?.platform)
      setReleaseInfo(nextReleaseInfo)
      if (nextReleaseInfo.error) {
        window.toast.error(t('settings.about.updateError'))
      } else if (nextReleaseInfo.hasUpdate) {
        await openExternal(nextReleaseInfo.releaseUrl)
      } else {
        window.toast.success(t('settings.about.updateNotAvailable'))
      }
    } finally {
      updateInFlight.current = false
      setCheckingUpdate(false)
    }
  }

  const checkUpdateLabel = releaseInfo?.hasUpdate
    ? t('settings.about.updateTo', { version: releaseInfo.latestVersion })
    : t('settings.about.checkUpdate.label')

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.assistant')}</SettingRowTitle>
          <Switch checked={notification.assistant} onChange={handleNotificationChange} />
        </SettingRow>
      </SettingGroup>
      {!runtimeCapabilities.android && (
        <>
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
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.general.auto_check_update.title')}</SettingRowTitle>
              <Switch checked={autoCheckUpdate} onChange={updateAutoCheckUpdate} />
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
        </>
      )}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.about.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.about.appVersion')}</SettingRowTitle>
          <Typography.Text type="secondary">{appInfo?.version || '-'}</Typography.Text>
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
