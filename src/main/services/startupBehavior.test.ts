import { describe, expect, it } from 'vitest'

import { ConfigKeys } from './ConfigManager'
import {
  buildLinuxAutostartDesktop,
  buildLoginItemSettings,
  buildMacOSLaunchAgentPath,
  buildMacOSLaunchAgentPlist,
  buildMacOSLaunchAgentProgramArguments,
  getMacOSAppBundlePath,
  LOGIN_STARTUP_ARG,
  MACOS_LAUNCH_AGENT_LABEL,
  shouldIgnoreLoginStartupSecondInstance,
  shouldStartSilentlyFromArgs
} from './startupBehavior'

describe('startup behavior helpers', () => {
  it('only treats the dedicated login startup arg as silent-start eligible', () => {
    expect(shouldStartSilentlyFromArgs([LOGIN_STARTUP_ARG], true)).toBe(true)
    expect(shouldStartSilentlyFromArgs([LOGIN_STARTUP_ARG], false)).toBe(false)
    expect(shouldStartSilentlyFromArgs([], true)).toBe(false)
    expect(shouldStartSilentlyFromArgs(['--lich13studio-login-startup=1'], true)).toBe(false)
  })

  it('builds login item settings with the login startup arg', () => {
    expect(buildLoginItemSettings(true)).toEqual({
      openAtLogin: true,
      args: [LOGIN_STARTUP_ARG]
    })
    expect(buildLoginItemSettings(false)).toEqual({
      openAtLogin: false,
      args: [LOGIN_STARTUP_ARG]
    })
  })

  it('derives the macOS app bundle path from a packaged executable path', () => {
    expect(getMacOSAppBundlePath('/Applications/lich13studio.app/Contents/MacOS/lich13studio')).toBe(
      '/Applications/lich13studio.app'
    )
    expect(getMacOSAppBundlePath('/Users/dev/lich13studio/out/main/index.js')).toBe(
      '/Users/dev/lich13studio/out/main/index.js'
    )
  })

  it('builds macOS LaunchAgent program arguments with a hidden app open', () => {
    expect(buildMacOSLaunchAgentProgramArguments('/Applications/lich13studio.app')).toEqual([
      '/usr/bin/open',
      '-g',
      '/Applications/lich13studio.app',
      '--args',
      LOGIN_STARTUP_ARG
    ])
    expect(buildMacOSLaunchAgentProgramArguments('/tmp/lich13studio')).toEqual(['/tmp/lich13studio', LOGIN_STARTUP_ARG])
  })

  it('builds a macOS LaunchAgent plist with escaped values and the startup arg', () => {
    const plist = buildMacOSLaunchAgentPlist('/Applications/lich&13"studio.app')

    expect(plist).toContain(`<string>${MACOS_LAUNCH_AGENT_LABEL}</string>`)
    expect(plist).toContain('<string>/usr/bin/open</string>')
    expect(plist).toContain('<string>-g</string>')
    expect(plist).toContain('<string>/Applications/lich&amp;13&quot;studio.app</string>')
    expect(plist).toContain('<string>--args</string>')
    expect(plist).toContain(`<string>${LOGIN_STARTUP_ARG}</string>`)
    expect(plist).toContain('<key>RunAtLoad</key>')
  })

  it('builds the stable macOS LaunchAgent path', () => {
    expect(buildMacOSLaunchAgentPath('/Users/gosu')).toBe('/Users/gosu/Library/LaunchAgents/com.lich13.studio.plist')
  })

  it('ignores only login-startup second instances without protocol URLs', () => {
    expect(shouldIgnoreLoginStartupSecondInstance([LOGIN_STARTUP_ARG], false)).toBe(true)
    expect(shouldIgnoreLoginStartupSecondInstance([LOGIN_STARTUP_ARG], true)).toBe(false)
    expect(shouldIgnoreLoginStartupSecondInstance([], false)).toBe(false)
  })

  it('builds linux autostart desktop content with the login startup arg', () => {
    expect(buildLinuxAutostartDesktop('/Applications/lich13studio', false)).toContain(
      `Exec="/Applications/lich13studio" ${LOGIN_STARTUP_ARG}`
    )
    expect(buildLinuxAutostartDesktop('/tmp/lich 13/studio', true)).toContain(
      `Exec="/tmp/lich 13/studio" ${LOGIN_STARTUP_ARG}`
    )
  })

  it('uses stable config keys for background behavior', () => {
    expect(ConfigKeys.LaunchToTray).toBe('launchToTray')
    expect(ConfigKeys.Tray).toBe('tray')
    expect(ConfigKeys.TrayOnClose).toBe('trayOnClose')
  })
})
