/// <reference lib="webworker" />

import { loggerService } from '@logger'
import { LRUCache } from 'lru-cache'
import { createBundledHighlighter, type HighlighterGeneric, type SpecialLanguage, type ThemedToken } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

import type { ShikiStreamTokenizerOptions } from '../services/ShikiStreamTokenizer'
import { ShikiStreamTokenizer } from '../services/ShikiStreamTokenizer'

const logger = loggerService.initWindowSource('Worker').withContext('ShikiStream')

type WorkerMessageType = 'init' | 'highlight' | 'pre-properties' | 'code-to-html' | 'cleanup' | 'dispose'

interface WorkerRequest {
  id: number
  type: WorkerMessageType
  callerId?: string
  chunk?: string
  code?: string
  language?: string
  theme?: string
  languages?: string[]
  themes?: string[]
}

interface WorkerResponse {
  id: number
  type: string
  result?: unknown
  error?: string
}

interface HighlightChunkResult {
  lines: ThemedToken[][]
  recall: number
}

const BUNDLED_LANGUAGES: Record<string, () => Promise<any>> = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  'c++': () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  cs: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  csv: () => import('shiki/langs/csv.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  docker: () => import('shiki/langs/dockerfile.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  golang: () => import('shiki/langs/go.mjs'),
  gql: () => import('shiki/langs/graphql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  http: () => import('shiki/langs/http.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  cjs: () => import('shiki/langs/javascript.mjs'),
  mjs: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsonl: () => import('shiki/langs/jsonl.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  kt: () => import('shiki/langs/kotlin.mjs'),
  kts: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/makefile.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  md: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  ps1: () => import('shiki/langs/powershell.mjs'),
  py: () => import('shiki/langs/python.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rb: () => import('shiki/langs/ruby.mjs'),
  regex: () => import('shiki/langs/regexp.mjs'),
  regexp: () => import('shiki/langs/regexp.mjs'),
  rs: () => import('shiki/langs/rust.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  bash: () => import('shiki/langs/shellscript.mjs'),
  sh: () => import('shiki/langs/shellscript.mjs'),
  shell: () => import('shiki/langs/shellscript.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  zsh: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ts: () => import('shiki/langs/typescript.mjs'),
  cts: () => import('shiki/langs/typescript.mjs'),
  mts: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  yml: () => import('shiki/langs/yaml.mjs')
}

const BUNDLED_THEMES: Record<string, () => Promise<any>> = {
  andromeeda: () => import('shiki/themes/andromeeda.mjs'),
  'aurora-x': () => import('shiki/themes/aurora-x.mjs'),
  'ayu-dark': () => import('shiki/themes/ayu-dark.mjs'),
  'catppuccin-frappe': () => import('shiki/themes/catppuccin-frappe.mjs'),
  'catppuccin-latte': () => import('shiki/themes/catppuccin-latte.mjs'),
  'catppuccin-macchiato': () => import('shiki/themes/catppuccin-macchiato.mjs'),
  'catppuccin-mocha': () => import('shiki/themes/catppuccin-mocha.mjs'),
  'dark-plus': () => import('shiki/themes/dark-plus.mjs'),
  dracula: () => import('shiki/themes/dracula.mjs'),
  'dracula-soft': () => import('shiki/themes/dracula-soft.mjs'),
  'everforest-dark': () => import('shiki/themes/everforest-dark.mjs'),
  'everforest-light': () => import('shiki/themes/everforest-light.mjs'),
  'github-dark': () => import('shiki/themes/github-dark.mjs'),
  'github-dark-default': () => import('shiki/themes/github-dark-default.mjs'),
  'github-dark-dimmed': () => import('shiki/themes/github-dark-dimmed.mjs'),
  'github-dark-high-contrast': () => import('shiki/themes/github-dark-high-contrast.mjs'),
  'github-light': () => import('shiki/themes/github-light.mjs'),
  'github-light-default': () => import('shiki/themes/github-light-default.mjs'),
  'github-light-high-contrast': () => import('shiki/themes/github-light-high-contrast.mjs'),
  'gruvbox-dark-hard': () => import('shiki/themes/gruvbox-dark-hard.mjs'),
  'gruvbox-dark-medium': () => import('shiki/themes/gruvbox-dark-medium.mjs'),
  'gruvbox-dark-soft': () => import('shiki/themes/gruvbox-dark-soft.mjs'),
  'gruvbox-light-hard': () => import('shiki/themes/gruvbox-light-hard.mjs'),
  'gruvbox-light-medium': () => import('shiki/themes/gruvbox-light-medium.mjs'),
  'gruvbox-light-soft': () => import('shiki/themes/gruvbox-light-soft.mjs'),
  houston: () => import('shiki/themes/houston.mjs'),
  'kanagawa-dragon': () => import('shiki/themes/kanagawa-dragon.mjs'),
  'kanagawa-lotus': () => import('shiki/themes/kanagawa-lotus.mjs'),
  'kanagawa-wave': () => import('shiki/themes/kanagawa-wave.mjs'),
  laserwave: () => import('shiki/themes/laserwave.mjs'),
  'light-plus': () => import('shiki/themes/light-plus.mjs'),
  'material-theme': () => import('shiki/themes/material-theme.mjs'),
  'material-theme-darker': () => import('shiki/themes/material-theme-darker.mjs'),
  'material-theme-lighter': () => import('shiki/themes/material-theme-lighter.mjs'),
  'material-theme-ocean': () => import('shiki/themes/material-theme-ocean.mjs'),
  'material-theme-palenight': () => import('shiki/themes/material-theme-palenight.mjs'),
  'min-dark': () => import('shiki/themes/min-dark.mjs'),
  'min-light': () => import('shiki/themes/min-light.mjs'),
  monokai: () => import('shiki/themes/monokai.mjs'),
  'night-owl': () => import('shiki/themes/night-owl.mjs'),
  nord: () => import('shiki/themes/nord.mjs'),
  'one-dark-pro': () => import('shiki/themes/one-dark-pro.mjs'),
  'one-light': () => import('shiki/themes/one-light.mjs'),
  plastic: () => import('shiki/themes/plastic.mjs'),
  poimandres: () => import('shiki/themes/poimandres.mjs'),
  red: () => import('shiki/themes/red.mjs'),
  'rose-pine': () => import('shiki/themes/rose-pine.mjs'),
  'rose-pine-dawn': () => import('shiki/themes/rose-pine-dawn.mjs'),
  'rose-pine-moon': () => import('shiki/themes/rose-pine-moon.mjs'),
  'slack-dark': () => import('shiki/themes/slack-dark.mjs'),
  'slack-ochin': () => import('shiki/themes/slack-ochin.mjs'),
  'snazzy-light': () => import('shiki/themes/snazzy-light.mjs'),
  'solarized-dark': () => import('shiki/themes/solarized-dark.mjs'),
  'solarized-light': () => import('shiki/themes/solarized-light.mjs'),
  'synthwave-84': () => import('shiki/themes/synthwave-84.mjs'),
  'tokyo-night': () => import('shiki/themes/tokyo-night.mjs'),
  vesper: () => import('shiki/themes/vesper.mjs'),
  'vitesse-black': () => import('shiki/themes/vitesse-black.mjs'),
  'vitesse-dark': () => import('shiki/themes/vitesse-dark.mjs'),
  'vitesse-light': () => import('shiki/themes/vitesse-light.mjs')
}

const createHighlighter = createBundledHighlighter({
  langs: BUNDLED_LANGUAGES,
  themes: BUNDLED_THEMES,
  engine: () => createOnigurumaEngine(import('shiki/wasm'))
})

let highlighter: HighlighterGeneric<any, any> | null = null

const tokenizerMap = new LRUCache<string, ShikiStreamTokenizer>({
  max: 100,
  ttl: 1000 * 60 * 15,
  updateAgeOnGet: true,
  dispose: (value) => {
    if (value) value.clear()
  }
})

async function initHighlighter(themes: string[], languages: string[]): Promise<void> {
  highlighter = await createHighlighter({
    langs: languages as any,
    themes: themes as any
  })
}

async function ensureLanguageAndThemeLoaded(
  language: string,
  theme: string
): Promise<{ actualLanguage: string; actualTheme: string }> {
  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }

  const normalizedLang = language.trim().toLowerCase() || 'text'
  let actualLanguage = normalizedLang
  let actualTheme = theme

  if (!highlighter.getLoadedLanguages().includes(normalizedLang)) {
    try {
      if (['text', 'ansi'].includes(normalizedLang)) {
        await highlighter.loadLanguage(normalizedLang as SpecialLanguage)
      } else {
        const languageImportFn = BUNDLED_LANGUAGES[normalizedLang]
        if (!languageImportFn) {
          throw new Error(`Unsupported language: ${normalizedLang}`)
        }
        const langData = await languageImportFn()
        await highlighter.loadLanguage(langData)
      }
    } catch {
      await highlighter.loadLanguage('text')
      actualLanguage = 'text'
    }
  }

  if (!highlighter.getLoadedThemes().includes(theme)) {
    try {
      const themeImportFn = BUNDLED_THEMES[theme]
      if (!themeImportFn) {
        throw new Error(`Unsupported web bundle theme: ${theme}`)
      }
      const themeData = await themeImportFn()
      await highlighter.loadTheme(themeData)
    } catch (error) {
      logger.debug(`Worker: Failed to load theme '${theme}', falling back to 'one-light':`, error as Error)
      const oneLightTheme = await BUNDLED_THEMES['one-light']()
      await highlighter.loadTheme(oneLightTheme)
      actualTheme = 'one-light'
    }
  }

  return { actualLanguage, actualTheme }
}

async function getStreamTokenizer(callerId: string, language: string, theme: string): Promise<ShikiStreamTokenizer> {
  const cacheKey = `${callerId}-${language}-${theme}`
  if (tokenizerMap.has(cacheKey)) {
    return tokenizerMap.get(cacheKey)!
  }

  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }

  const { actualLanguage, actualTheme } = await ensureLanguageAndThemeLoaded(language, theme)
  const options: ShikiStreamTokenizerOptions = {
    highlighter,
    lang: actualLanguage,
    theme: actualTheme
  }

  const tokenizer = new ShikiStreamTokenizer(options)
  tokenizerMap.set(cacheKey, tokenizer)
  return tokenizer
}

async function highlightCodeChunk(
  callerId: string,
  chunk: string,
  language: string,
  theme: string
): Promise<HighlightChunkResult> {
  try {
    const tokenizer = await getStreamTokenizer(callerId, language, theme)
    const result = await tokenizer.enqueue(chunk)
    return {
      lines: [...result.stable, ...result.unstable],
      recall: result.recall
    }
  } catch (error) {
    logger.error('Worker failed to highlight code chunk:', error as Error)
    return {
      lines: (chunk || '').split('\n').map((line) => [{ content: line, offset: 0 }]),
      recall: 0
    }
  }
}

async function getPreProperties(language: string, theme: string) {
  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }
  const { actualLanguage, actualTheme } = await ensureLanguageAndThemeLoaded(language, theme)
  const hast = highlighter.codeToHast('1', {
    lang: actualLanguage,
    theme: actualTheme
  })
  const firstChild = hast.children[0] as { properties?: Record<string, unknown> } | undefined
  return (firstChild?.properties ?? { class: 'shiki', style: '', tabindex: 0 }) as {
    class: string
    style: string
    tabindex: number
  }
}

async function renderCodeToHtml(code: string, language: string, theme: string): Promise<string> {
  if (!highlighter) {
    throw new Error('Highlighter not initialized')
  }
  const { actualLanguage, actualTheme } = await ensureLanguageAndThemeLoaded(language, theme)
  return highlighter.codeToHtml(code, {
    lang: actualLanguage,
    theme: actualTheme
  })
}

function cleanupTokenizer(callerId: string): void {
  for (const key of tokenizerMap.keys()) {
    if (key.startsWith(`${callerId}-`)) {
      tokenizerMap.delete(key)
    }
  }
}

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type } = e.data

  try {
    switch (type) {
      case 'init':
        if (e.data.languages && e.data.themes) {
          await initHighlighter(e.data.themes, e.data.languages)
          self.postMessage({ id, type: 'init-result', result: { success: true } } as WorkerResponse)
        } else {
          throw new Error('Missing required init parameters')
        }
        break

      case 'highlight':
        if (!highlighter) {
          throw new Error('Highlighter not initialized')
        }
        if (e.data.callerId && e.data.chunk !== undefined && e.data.language && e.data.theme) {
          const result = await highlightCodeChunk(e.data.callerId, e.data.chunk, e.data.language, e.data.theme)
          self.postMessage({ id, type: 'highlight-result', result } as WorkerResponse)
        } else {
          throw new Error('Missing required highlight parameters')
        }
        break

      case 'pre-properties':
        if (!highlighter) {
          throw new Error('Highlighter not initialized')
        }
        if (e.data.language && e.data.theme) {
          const result = await getPreProperties(e.data.language, e.data.theme)
          self.postMessage({ id, type: 'pre-properties-result', result } as WorkerResponse)
        } else {
          throw new Error('Missing required pre-properties parameters')
        }
        break

      case 'code-to-html':
        if (!highlighter) {
          throw new Error('Highlighter not initialized')
        }
        if (e.data.code !== undefined && e.data.language && e.data.theme) {
          const result = await renderCodeToHtml(e.data.code, e.data.language, e.data.theme)
          self.postMessage({ id, type: 'code-to-html-result', result } as WorkerResponse)
        } else {
          throw new Error('Missing required code-to-html parameters')
        }
        break

      case 'cleanup':
        if (e.data.callerId) {
          cleanupTokenizer(e.data.callerId)
          self.postMessage({ id, type: 'cleanup-result', result: { success: true } } as WorkerResponse)
        } else {
          throw new Error('Missing callerId for cleanup')
        }
        break

      case 'dispose':
        tokenizerMap.clear()
        highlighter?.dispose()
        highlighter = null
        self.postMessage({ id, type: 'dispose-result', result: { success: true } } as WorkerResponse)
        break

      default:
        throw new Error(`Unknown command: ${type}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    self.postMessage({
      id,
      type: 'error',
      error: errorMessage
    } as WorkerResponse)
  }
}
