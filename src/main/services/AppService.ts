import { loggerService } from '@logger'
import { isDev, isLinux, isMac, isWin } from '@main/constant'
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  buildLinuxAutostartDesktop,
  buildLoginItemSettings,
  buildMacOSLegacyLaunchAgentPath,
  buildMacOSLoginItemSettings
} from './startupBehavior'

const logger = loggerService.withContext('AppService')

export class AppService {
  private static instance: AppService

  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService()
    }
    return AppService.instance
  }

  public async setAppLaunchOnBoot(isLaunchOnBoot: boolean): Promise<void> {
    if (isWin) {
      app.setLoginItemSettings(buildLoginItemSettings(isLaunchOnBoot))
    } else if (isMac) {
      try {
        app.setLoginItemSettings(buildMacOSLoginItemSettings(isLaunchOnBoot))

        try {
          await fs.promises.unlink(buildMacOSLegacyLaunchAgentPath(os.homedir()))
          logger.info('Removed legacy macOS LaunchAgent for login startup')
        } catch (error: any) {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        }
      } catch (error) {
        logger.error('Failed to set launch on boot for macOS:', error as Error)
      }
    } else if (isLinux) {
      try {
        const autostartDir = path.join(os.homedir(), '.config', 'autostart')
        const desktopFile = path.join(autostartDir, isDev ? 'lich13studio-dev.desktop' : 'lich13studio.desktop')

        if (isLaunchOnBoot) {
          // Ensure autostart directory exists
          try {
            await fs.promises.access(autostartDir)
          } catch {
            await fs.promises.mkdir(autostartDir, { recursive: true })
          }

          // Get executable path
          let executablePath = app.getPath('exe')
          if (process.env.APPIMAGE) {
            // For AppImage packaged apps, use APPIMAGE environment variable
            executablePath = process.env.APPIMAGE
          }

          const desktopContent = buildLinuxAutostartDesktop(executablePath, isDev)

          // Write desktop file
          await fs.promises.writeFile(desktopFile, desktopContent)
          logger.info('Created autostart desktop file for Linux')
        } else {
          // Remove desktop file
          try {
            await fs.promises.access(desktopFile)
            await fs.promises.unlink(desktopFile)
            logger.info('Removed autostart desktop file for Linux')
          } catch {
            // File doesn't exist, no need to remove
          }
        }
      } catch (error) {
        logger.error('Failed to set launch on boot for Linux:', error as Error)
      }
    }
  }
}

// Default export as singleton instance
export default AppService.getInstance()
