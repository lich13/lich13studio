/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { DEFAULT_SIDEBAR_ICONS } from '@renderer/config/sidebar'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import type { AssistantIconType, SendMessageShortcut, SettingsState } from '@renderer/store/settings'
import {
  setAssistantIconType,
  setAutoCheckUpdate as _setAutoCheckUpdate,
  setLaunchOnBoot,
  setNavbarPosition,
  setSendMessageShortcut as _setSendMessageShortcut,
  setTargetLanguage,
  setTestChannel as _setTestChannel,
  setTestPlan as _setTestPlan,
  setTheme,
  setTopicPosition,
  setUseSystemTitleBar as _setUseSystemTitleBar,
  setWindowStyle
} from '@renderer/store/settings'
import type { SidebarIcon, ThemeMode, TranslateLanguageCode } from '@renderer/types'
import type { UpgradeChannel } from '@shared/config/constant'

const RETIRED_SIDEBAR_ICONS = new Set<SidebarIcon>(['store', 'translate', 'knowledge'])

const sanitizeSidebarIcons = (icons: SidebarIcon[]) => icons.filter((icon) => !RETIRED_SIDEBAR_ICONS.has(icon))

export function useSettings() {
  const settings = useAppSelector((state) => state.settings)
  const dispatch = useAppDispatch()
  const sidebarIcons = {
    visible: sanitizeSidebarIcons(DEFAULT_SIDEBAR_ICONS),
    disabled: [] as SidebarIcon[]
  }

  return {
    ...settings,
    language: 'zh-CN' as SettingsState['language'],
    launchToTray: false,
    tray: false,
    trayOnClose: false,
    clickAssistantToShowTopic: true,
    showTopicTime: false,
    pinTopicsToTop: false,
    enableDataCollection: false,
    enableSpellCheck: false,
    disableHardwareAcceleration: false,
    notification: {
      ...settings.notification,
      backup: false
    },
    sidebarIcons,
    setSendMessageShortcut(shortcut: SendMessageShortcut) {
      dispatch(_setSendMessageShortcut(shortcut))
    },

    setLaunch(isLaunchOnBoot: boolean | undefined) {
      if (isLaunchOnBoot !== undefined) {
        dispatch(setLaunchOnBoot(isLaunchOnBoot))
        void window.api.setLaunchOnBoot(isLaunchOnBoot)
      }
    },

    setTray() {
      return undefined
    },

    setAutoCheckUpdate(isAutoUpdate: boolean) {
      dispatch(_setAutoCheckUpdate(isAutoUpdate))
      void window.api.setAutoUpdate(isAutoUpdate)
    },

    setTestPlan(isTestPlan: boolean) {
      dispatch(_setTestPlan(isTestPlan))
      void window.api.setTestPlan(isTestPlan)
    },

    setTestChannel(channel: UpgradeChannel) {
      dispatch(_setTestChannel(channel))
      void window.api.setTestChannel(channel)
    },

    setTheme(theme: ThemeMode) {
      dispatch(setTheme(theme))
    },
    setWindowStyle(windowStyle: 'transparent' | 'opaque') {
      dispatch(setWindowStyle(windowStyle))
    },
    setTargetLanguage(targetLanguage: TranslateLanguageCode) {
      dispatch(setTargetLanguage(targetLanguage))
    },
    setTopicPosition(topicPosition: 'left' | 'right') {
      dispatch(setTopicPosition(topicPosition))
    },
    setAssistantIconType(assistantIconType: AssistantIconType) {
      dispatch(setAssistantIconType(assistantIconType))
    },
    setUseSystemTitleBar(useSystemTitleBar: boolean) {
      dispatch(_setUseSystemTitleBar(useSystemTitleBar))
      void window.api.setUseSystemTitleBar(useSystemTitleBar)
    }
  }
}

export function useMessageStyle() {
  const { messageStyle } = useSettings()
  const isBubbleStyle = messageStyle === 'bubble'

  return {
    isBubbleStyle
  }
}

export const getStoreSetting = <K extends keyof SettingsState>(key: K): SettingsState[K] => {
  return store.getState().settings[key]
}

export const useEnableDeveloperMode = () => {
  return {
    enableDeveloperMode: false,
    setEnableDeveloperMode: () => undefined
  }
}

export const getEnableDeveloperMode = () => {
  return false
}

export const useNavbarPosition = () => {
  const navbarPosition = useAppSelector((state) => state.settings.navbarPosition)
  const dispatch = useAppDispatch()

  return {
    navbarPosition,
    isLeftNavbar: navbarPosition === 'left',
    isTopNavbar: navbarPosition === 'top',
    setNavbarPosition: (position: 'left' | 'top') => dispatch(setNavbarPosition(position))
  }
}
