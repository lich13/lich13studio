import { loggerService } from '@logger'
import type { BrowserView, BrowserWindow } from 'electron'

type PublicLogger = Pick<
  ReturnType<typeof loggerService.withContext>,
  'debug' | 'info' | 'warn' | 'error' | 'verbose' | 'silly'
>

export const logger: PublicLogger = loggerService.withContext('MCPBrowserCDP')
export const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface TabInfo {
  id: string
  view: BrowserView
  url: string
  title: string
  lastActive: number
}

export interface WindowInfo {
  windowKey: string
  privateMode: boolean
  window: BrowserWindow
  tabs: Map<string, TabInfo>
  activeTabId: string | null
  lastActive: number
  tabBarView?: BrowserView
}
