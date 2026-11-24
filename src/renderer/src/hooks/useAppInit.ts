import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import i18n, { setDayjsLocale } from '@renderer/i18n'
import { notifyLatestReleaseIfAvailable } from '@renderer/services/appUpdateNotification'
import { handleSaveData, useAppDispatch } from '@renderer/store'
import { setAvatar, setFilesPath, setResourcesPath } from '@renderer/store/runtime'
import { checkDataLimit, runAsyncFunction } from '@renderer/utils'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { getMainProcessSettingUpdates } from './settingsSync'
import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useRuntime } from './useRuntime'
import { useNavbarPosition, useSettings } from './useSettings'

const logger = loggerService.withContext('useAppInit')

export function useAppInit() {
  const dispatch = useAppDispatch()
  const {
    proxyUrl,
    proxyBypassRules,
    language,
    windowStyle,
    autoCheckUpdate,
    proxyMode,
    launchToTray,
    tray,
    trayOnClose
  } = useSettings()
  const { isLeftNavbar } = useNavbarPosition()
  const { minappShow } = useRuntime()
  const { setDefaultModel, setQuickModel, setTranslateModel } = useDefaultModel()
  const avatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()

  useEffect(() => {
    void import('@renderer/init')
  }, [])

  useEffect(() => {
    void window.api.getDataPathFromArgs().then((dataPath) => {
      if (dataPath) {
        window.navigate('/settings/data', { replace: true })
      }
    })
  }, [])

  useEffect(() => {
    return window.api.onSaveData(async () => {
      await handleSaveData()
    })
  }, [])

  useFullScreenNotice()

  useEffect(() => {
    if (!window.__LICH13_TAURI_SHIM__) {
      return
    }

    void runAsyncFunction(async () => {
      for (const [key, value] of getMainProcessSettingUpdates({ launchToTray, tray, trayOnClose })) {
        await window.api.config.set(key, value, true)
      }
    }).catch((error) => {
      logger.warn('Failed to sync Tauri background settings', error as Error)
    })
  }, [launchToTray, tray, trayOnClose])

  useEffect(() => {
    avatar?.value && dispatch(setAvatar(avatar.value))
  }, [avatar, dispatch])

  useEffect(() => {
    if (!autoCheckUpdate || !window.__LICH13_TAURI_SHIM__) {
      return
    }

    const timer = window.setTimeout(() => {
      void runAsyncFunction(async () => {
        const appInfo = await window.api.getAppInfo()
        await notifyLatestReleaseIfAvailable(appInfo.version, appInfo.platform)
      })
    }, 2000)

    return () => window.clearTimeout(timer)
  }, [autoCheckUpdate])

  useEffect(() => {
    if (proxyMode === 'system') {
      void window.api.setProxy('system', undefined)
    } else if (proxyMode === 'custom') {
      void (proxyUrl && window.api.setProxy(proxyUrl, proxyBypassRules))
    } else {
      // set proxy to none for direct mode
      void window.api.setProxy('', undefined)
    }
  }, [proxyUrl, proxyMode, proxyBypassRules])

  useEffect(() => {
    const currentLanguage = 'zh-CN'
    void i18n.changeLanguage(currentLanguage)
    setDayjsLocale(currentLanguage)
  }, [language])

  useEffect(() => {
    const isMacTransparentWindow = windowStyle === 'transparent' && isMac

    if (minappShow && isLeftNavbar) {
      window.root.style.background = isMacTransparentWindow ? 'var(--color-background)' : 'var(--navbar-background)'
      return
    }

    window.root.style.background = isMacTransparentWindow ? 'var(--navbar-background-mac)' : 'var(--navbar-background)'
  }, [windowStyle, minappShow, theme, isLeftNavbar])

  useEffect(() => {
    if (isLocalAi) {
      const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)
      setDefaultModel(model)
      setQuickModel(model)
      setTranslateModel(model)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // set files path
    void window.api.getAppInfo().then((info) => {
      dispatch(setFilesPath(info.filesPath))
      dispatch(setResourcesPath(info.resourcesPath))
    })
  }, [dispatch])

  useEffect(() => {
    void checkDataLimit()
  }, [])
}
