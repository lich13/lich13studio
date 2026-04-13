import { loggerService } from '@logger'
import { isMac } from '@main/constant'

import { windowService } from '../WindowService'

const logger = loggerService.withContext('URLSchema:handleNavigateProtocolUrl')

// Allowed route prefixes to prevent arbitrary navigation
const ALLOWED_ROUTES = [
  '/settings/',
  '/agents',
  '/openclaw',
  '/paintings',
  '/files',
  '/notes',
  '/apps',
  '/code',
  '/launchpad',
  '/'
]

/**
 * Handle lich13studio://navigate/<path> deep links.
 *
 * Examples:
 *   lich13studio://navigate/settings/provider
 *   lich13studio://navigate/agents
 *   lich13studio://navigate/openclaw
 */
export function handleNavigateProtocolUrl(url: URL) {
  const targetPath = url.pathname || '/'
  const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`

  if (!ALLOWED_ROUTES.some((route) => normalizedPath === route || normalizedPath.startsWith(route))) {
    logger.warn(`Blocked navigation to disallowed route: ${normalizedPath}`)
    return
  }

  // Preserve query parameters from the URL
  const queryString = url.search || ''
  const fullPath = `${normalizedPath}${queryString}`

  logger.debug('handleNavigateProtocolUrl', { path: fullPath })

  const mainWindow = windowService.getMainWindow()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents
      .executeJavaScript(`typeof window.navigate === 'function'`)
      .then((hasNavigate) => {
        if (hasNavigate) {
          void mainWindow.webContents.executeJavaScript(`window.navigate('${fullPath}')`)
          if (isMac) {
            windowService.showMainWindow()
          }
        } else {
          logger.warn('window.navigate not available yet, retrying in 1s')
          setTimeout(() => handleNavigateProtocolUrl(url), 1000)
        }
      })
      .catch((error) => {
        logger.error('Failed to navigate:', error as Error)
      })
  } else {
    logger.warn('Main window not available, retrying in 1s')
    setTimeout(() => handleNavigateProtocolUrl(url), 1000)
  }
}
