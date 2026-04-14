import { isMac, isWin } from '@renderer/config/constant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ThemeMode } from '@renderer/types'
import type { PropsWithChildren } from 'react'
import React, { createContext, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.system,
  settedTheme: ThemeMode.dark,
  toggleTheme: () => {},
  setTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

const tailwindThemeChange = (theme: ThemeMode) => {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
}

const getSystemTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeMode.dark : ThemeMode.light

const resolveActualTheme = (theme: ThemeMode) => (theme === ThemeMode.system ? getSystemTheme() : theme)

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // 用户设置的主题
  const { theme: settedTheme, setTheme: setSettedTheme, language } = useSettings()
  const [actualTheme, setActualTheme] = useState<ThemeMode>(() => resolveActualTheme(settedTheme))
  const { initUserTheme } = useUserTheme()
  const { navbarPosition } = useNavbarPosition()

  const toggleTheme = () => {
    const nextTheme = {
      [ThemeMode.light]: ThemeMode.dark,
      [ThemeMode.dark]: ThemeMode.system,
      [ThemeMode.system]: ThemeMode.light
    }[settedTheme]
    setSettedTheme(nextTheme || ThemeMode.system)
  }

  useEffect(() => {
    setActualTheme(resolveActualTheme(settedTheme))
  }, [settedTheme])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      if (settedTheme === ThemeMode.system) {
        setActualTheme(getSystemTheme())
      }
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }

    mediaQuery.addListener(handleSystemThemeChange)
    return () => mediaQuery.removeListener(handleSystemThemeChange)
  }, [settedTheme])

  useEffect(() => {
    document.body.setAttribute('os', isMac ? 'mac' : isWin ? 'windows' : 'linux')
    document.body.setAttribute('theme-mode', actualTheme)
    if (actualTheme === ThemeMode.dark) {
      document.body.classList.remove('light')
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
      document.body.classList.add('light')
    }
    document.body.setAttribute('navbar-position', navbarPosition)
    document.documentElement.lang = language

    // if theme is old auto, then set theme to system
    // we can delete this after next big release
    if (settedTheme !== ThemeMode.dark && settedTheme !== ThemeMode.light && settedTheme !== ThemeMode.system) {
      setSettedTheme(ThemeMode.system)
    }

    initUserTheme()
  }, [actualTheme, initUserTheme, language, navbarPosition, setSettedTheme, settedTheme])

  useEffect(() => {
    return window.api.onThemeUpdated((theme: ThemeMode) => {
      setActualTheme(theme)
    })
  }, [])

  useEffect(() => {
    tailwindThemeChange(actualTheme)
  }, [actualTheme])

  useEffect(() => {
    void window.api.setTheme(settedTheme)
  }, [settedTheme])

  return (
    <ThemeContext value={{ theme: actualTheme, settedTheme, toggleTheme, setTheme: setSettedTheme }}>
      {children}
    </ThemeContext>
  )
}

export const useTheme = () => use(ThemeContext)
