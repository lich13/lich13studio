import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import type { HighlightChunkResult, ShikiPreProperties } from '@renderer/services/ShikiStreamService'
import { shikiStreamService } from '@renderer/services/ShikiStreamService'
import { ThemeMode } from '@renderer/types'
import { CM_THEME_NAMES, SHIKI_WEB_THEMES } from '@renderer/utils/shiki'
import type React from 'react'
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo } from 'react'

interface CodeStyleContextType {
  highlightCodeChunk: (trunk: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  highlightStreamingCode: (code: string, language: string, callerId: string) => Promise<HighlightChunkResult>
  cleanupTokenizers: (callerId: string) => void
  getShikiPreProperties: (language: string) => Promise<ShikiPreProperties>
  highlightCode: (code: string, language: string) => Promise<string>
  themeNames: string[]
  activeShikiTheme: string
  isShikiThemeDark: boolean
  activeCmThemeName: string
}

const SHIKI_THEME_NAMES = ['auto', ...SHIKI_WEB_THEMES.map((info) => info.id)]
const SHIKI_DARK_THEMES = new Set(SHIKI_WEB_THEMES.filter((info) => info.type === 'dark').map((info) => info.id))

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shell',
  'objective-c++': 'objective-cpp',
  svg: 'xml',
  vab: 'vb',
  graphviz: 'dot'
}

const defaultCodeStyleContext: CodeStyleContextType = {
  highlightCodeChunk: async () => ({ lines: [], recall: 0 }),
  highlightStreamingCode: async () => ({ lines: [], recall: 0 }),
  cleanupTokenizers: () => {},
  getShikiPreProperties: async () => ({ class: '', style: '', tabindex: 0 }),
  highlightCode: async () => '',
  themeNames: ['auto'],
  activeShikiTheme: 'auto',
  isShikiThemeDark: false,
  activeCmThemeName: 'light'
}

const CodeStyleContext = createContext<CodeStyleContextType>(defaultCodeStyleContext)

export const CodeStyleProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { codeEditor, codeViewer } = useSettings()
  const { theme } = useTheme()

  const themeNames = useMemo(() => (codeEditor.enabled ? [...CM_THEME_NAMES] : SHIKI_THEME_NAMES), [codeEditor.enabled])

  const activeShikiTheme = useMemo(() => {
    const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
    const codeStyle = codeViewer[field]
    if (!codeStyle || codeStyle === 'auto' || !SHIKI_THEME_NAMES.includes(codeStyle)) {
      return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
    }
    return codeStyle
  }, [theme, codeViewer])

  const isShikiThemeDark = useMemo(() => SHIKI_DARK_THEMES.has(activeShikiTheme), [activeShikiTheme])

  const activeCmThemeName = useMemo(() => {
    const field = theme === ThemeMode.light ? 'themeLight' : 'themeDark'
    const themeName = codeEditor[field]
    if (!themeName || themeName === 'auto' || !CM_THEME_NAMES.includes(themeName)) {
      return theme === ThemeMode.light ? 'materialLight' : 'dark'
    }
    return themeName
  }, [theme, codeEditor])

  useEffect(() => {
    return () => {
      shikiStreamService.dispose()
    }
  }, [])

  const normalizeLang = useCallback((language: string) => {
    const lower = (language || 'text').toLowerCase()
    return LANGUAGE_ALIASES[lower] || LANGUAGE_ALIASES[language] || lower
  }, [])

  const highlightCodeChunk = useCallback(
    async (trunk: string, language: string, callerId: string) => {
      return shikiStreamService.highlightCodeChunk(trunk, normalizeLang(language), activeShikiTheme, callerId)
    },
    [activeShikiTheme, normalizeLang]
  )

  const cleanupTokenizers = useCallback((callerId: string) => {
    shikiStreamService.cleanupTokenizers(callerId)
  }, [])

  const highlightStreamingCode = useCallback(
    async (fullContent: string, language: string, callerId: string) => {
      return shikiStreamService.highlightStreamingCode(fullContent, normalizeLang(language), activeShikiTheme, callerId)
    },
    [activeShikiTheme, normalizeLang]
  )

  const getShikiPreProperties = useCallback(
    async (language: string) => {
      return shikiStreamService.getShikiPreProperties(normalizeLang(language), activeShikiTheme)
    },
    [activeShikiTheme, normalizeLang]
  )

  const highlightCode = useCallback(
    async (code: string, language: string) => {
      return shikiStreamService.highlightCode(code, normalizeLang(language), activeShikiTheme)
    },
    [activeShikiTheme, normalizeLang]
  )

  const contextValue = useMemo(
    () => ({
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      themeNames,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmThemeName
    }),
    [
      highlightCodeChunk,
      highlightStreamingCode,
      cleanupTokenizers,
      getShikiPreProperties,
      highlightCode,
      themeNames,
      activeShikiTheme,
      isShikiThemeDark,
      activeCmThemeName
    ]
  )

  return <CodeStyleContext value={contextValue}>{children}</CodeStyleContext>
}

export const useCodeStyle = () => {
  const context = use(CodeStyleContext)
  if (!context) {
    throw new Error('useCodeStyle must be used within a CodeStyleProvider')
  }
  return context
}
