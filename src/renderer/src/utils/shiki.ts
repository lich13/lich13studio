import type { ThemedToken } from 'shiki/core'

export const DEFAULT_LANGUAGES = ['text', 'javascript', 'typescript', 'python', 'java', 'markdown', 'json']
export const DEFAULT_THEMES = ['one-light', 'material-theme-darker']

export interface ShikiThemeMetadata {
  id: string
  type: 'light' | 'dark'
}

export const SHIKI_WEB_THEMES: readonly ShikiThemeMetadata[] = [
  { id: 'andromeeda', type: 'dark' },
  { id: 'aurora-x', type: 'dark' },
  { id: 'ayu-dark', type: 'dark' },
  { id: 'catppuccin-frappe', type: 'dark' },
  { id: 'catppuccin-latte', type: 'light' },
  { id: 'catppuccin-macchiato', type: 'dark' },
  { id: 'catppuccin-mocha', type: 'dark' },
  { id: 'dark-plus', type: 'dark' },
  { id: 'dracula', type: 'dark' },
  { id: 'dracula-soft', type: 'dark' },
  { id: 'everforest-dark', type: 'dark' },
  { id: 'everforest-light', type: 'light' },
  { id: 'github-dark', type: 'dark' },
  { id: 'github-dark-default', type: 'dark' },
  { id: 'github-dark-dimmed', type: 'dark' },
  { id: 'github-dark-high-contrast', type: 'dark' },
  { id: 'github-light', type: 'light' },
  { id: 'github-light-default', type: 'light' },
  { id: 'github-light-high-contrast', type: 'light' },
  { id: 'gruvbox-dark-hard', type: 'dark' },
  { id: 'gruvbox-dark-medium', type: 'dark' },
  { id: 'gruvbox-dark-soft', type: 'dark' },
  { id: 'gruvbox-light-hard', type: 'light' },
  { id: 'gruvbox-light-medium', type: 'light' },
  { id: 'gruvbox-light-soft', type: 'light' },
  { id: 'houston', type: 'dark' },
  { id: 'kanagawa-dragon', type: 'dark' },
  { id: 'kanagawa-lotus', type: 'light' },
  { id: 'kanagawa-wave', type: 'dark' },
  { id: 'laserwave', type: 'dark' },
  { id: 'light-plus', type: 'light' },
  { id: 'material-theme', type: 'dark' },
  { id: 'material-theme-darker', type: 'dark' },
  { id: 'material-theme-lighter', type: 'light' },
  { id: 'material-theme-ocean', type: 'dark' },
  { id: 'material-theme-palenight', type: 'dark' },
  { id: 'min-dark', type: 'dark' },
  { id: 'min-light', type: 'light' },
  { id: 'monokai', type: 'dark' },
  { id: 'night-owl', type: 'dark' },
  { id: 'nord', type: 'dark' },
  { id: 'one-dark-pro', type: 'dark' },
  { id: 'one-light', type: 'light' },
  { id: 'plastic', type: 'dark' },
  { id: 'poimandres', type: 'dark' },
  { id: 'red', type: 'dark' },
  { id: 'rose-pine', type: 'dark' },
  { id: 'rose-pine-dawn', type: 'light' },
  { id: 'rose-pine-moon', type: 'dark' },
  { id: 'slack-dark', type: 'dark' },
  { id: 'slack-ochin', type: 'light' },
  { id: 'snazzy-light', type: 'light' },
  { id: 'solarized-dark', type: 'dark' },
  { id: 'solarized-light', type: 'light' },
  { id: 'synthwave-84', type: 'dark' },
  { id: 'tokyo-night', type: 'dark' },
  { id: 'vesper', type: 'dark' },
  { id: 'vitesse-black', type: 'dark' },
  { id: 'vitesse-dark', type: 'dark' },
  { id: 'vitesse-light', type: 'light' }
]

export const CM_THEME_NAMES: readonly string[] = [
  'auto',
  'light',
  'dark',
  'abcdef',
  'abyss',
  'androidstudio',
  'andromeda',
  'atomone',
  'aura',
  'basicDark',
  'basicLight',
  'bbedit',
  'bespin',
  'consoleDark',
  'consoleLight',
  'copilot',
  'darcula',
  'dracula',
  'duotoneDark',
  'duotoneLight',
  'eclipse',
  'githubDark',
  'githubLight',
  'gruvboxDark',
  'gruvboxLight',
  'kimbie',
  'material',
  'materialDark',
  'materialLight',
  'monokai',
  'monokaiDimmed',
  'noctisLilac',
  'nord',
  'okaidia',
  'quietlight',
  'red',
  'solarizedDark',
  'solarizedLight',
  'sublime',
  'tokyoNight',
  'tokyoNightDay',
  'tokyoNightStorm',
  'tomorrowNightBlue',
  'vscodeDark',
  'vscodeLight',
  'whiteDark',
  'whiteLight',
  'xcodeDark',
  'xcodeLight'
]

/**
 * Convert a Shiki ThemedToken into a React inline style object.
 */
export function getReactStyleFromToken(token: ThemedToken): Record<string, string> {
  if (token.htmlStyle) {
    const reactStyle: Record<string, string> = {}
    for (const [key, value] of Object.entries(token.htmlStyle)) {
      switch (key) {
        case 'font-style':
          reactStyle.fontStyle = value
          break
        case 'font-weight':
          reactStyle.fontWeight = value
          break
        case 'background-color':
          reactStyle.backgroundColor = value
          break
        case 'text-decoration':
          reactStyle.textDecoration = value
          break
        default:
          reactStyle[key] = value
      }
    }
    return reactStyle
  }

  const reactStyle: Record<string, string> = {}
  if (token.color) {
    reactStyle.color = token.color
  }
  if (token.bgColor) {
    reactStyle.backgroundColor = token.bgColor
  }
  const fontStyle = token.fontStyle ?? 0
  if (fontStyle > 0) {
    if (fontStyle & 1) {
      reactStyle.fontStyle = 'italic'
    }
    if (fontStyle & 2) {
      reactStyle.fontWeight = 'bold'
    }
    const decorations: string[] = []
    if (fontStyle & 4) {
      decorations.push('underline')
    }
    if (fontStyle & 8) {
      decorations.push('line-through')
    }
    if (decorations.length > 0) {
      reactStyle.textDecoration = decorations.join(' ')
    }
  }
  return reactStyle
}
