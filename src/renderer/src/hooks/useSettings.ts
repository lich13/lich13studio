import { DEFAULT_SIDEBAR_ICONS } from '@renderer/config/sidebar'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import type { AssistantIconType, SendMessageShortcut, SettingsState } from '@renderer/store/settings'
import {
  setAssistantIconType,
  setAutoCheckUpdate as _setAutoCheckUpdate,
  setChatRequestMode as _setChatRequestMode,
  setLaunchOnBoot,
  setLaunchToTray,
  setNavbarPosition,
  setSendMessageShortcut as _setSendMessageShortcut,
  setTargetLanguage,
  setTheme,
  setTopicPosition,
  setTray as _setTray,
  setTrayOnClose,
  setWindowStyle
} from '@renderer/store/settings'
import type { SidebarIcon, ThemeMode, TranslateLanguageCode } from '@renderer/types'

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
    clickAssistantToShowTopic: true,
    showTopicTime: false,
    pinTopicsToTop: false,
    enableSpellCheck: false,
    disableHardwareAcceleration: false,
    sidebarIcons,
    setSendMessageShortcut(shortcut: SendMessageShortcut) {
      dispatch(_setSendMessageShortcut(shortcut))
    },
    setChatRequestMode(mode: SettingsState['chatRequestMode']) {
      dispatch(_setChatRequestMode(mode))
    },

    setLaunch(isLaunchOnBoot: boolean | undefined, isLaunchToTray: boolean | undefined = undefined) {
      if (isLaunchOnBoot !== undefined) {
        dispatch(setLaunchOnBoot(isLaunchOnBoot))
        void window.api.setLaunchOnBoot(isLaunchOnBoot)
      }

      if (isLaunchToTray !== undefined) {
        dispatch(setLaunchToTray(isLaunchToTray))
        if (isLaunchToTray) {
          dispatch(_setTray(true))
        }
      }
    },

    setTray(isShowTray: boolean | undefined, isTrayOnClose: boolean | undefined = undefined) {
      if (isShowTray !== undefined) {
        dispatch(_setTray(isShowTray))
      }
      if (isTrayOnClose !== undefined) {
        dispatch(setTrayOnClose(isTrayOnClose))
        if (isTrayOnClose) {
          dispatch(_setTray(true))
        }
      }
    },

    setAutoCheckUpdate(isAutoUpdate: boolean) {
      dispatch(_setAutoCheckUpdate(isAutoUpdate))
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
