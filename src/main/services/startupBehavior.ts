export const LOGIN_STARTUP_ARG = '--lich13studio-login-startup'
export const MACOS_LOGIN_ITEM_ARG = '--hidden'
export const MACOS_LEGACY_LAUNCH_AGENT_LABEL = 'com.lich13.studio'

export function hasLoginStartupArg(args: readonly string[] = []): boolean {
  return args.includes(LOGIN_STARTUP_ARG)
}

export function shouldStartSilentlyFromArgs(args: readonly string[], launchToTray: boolean): boolean {
  return launchToTray && hasLoginStartupArg(args)
}

export function shouldIgnoreLoginStartupSecondInstance(args: readonly string[], hasProtocolUrl: boolean): boolean {
  return hasLoginStartupArg(args) && !hasProtocolUrl
}

export function buildLoginItemSettings(openAtLogin: boolean): Electron.Settings {
  return {
    openAtLogin,
    args: [LOGIN_STARTUP_ARG]
  }
}

export function buildMacOSLoginItemSettings(openAtLogin: boolean): Electron.Settings {
  return {
    openAtLogin,
    args: [MACOS_LOGIN_ITEM_ARG]
  }
}

export function getMacOSAppBundlePath(executablePath: string): string {
  const appContentsMarker = '.app/Contents/MacOS/'
  const appContentsIndex = executablePath.indexOf(appContentsMarker)

  if (appContentsIndex === -1) {
    return executablePath
  }

  return executablePath.slice(0, appContentsIndex + '.app'.length)
}

export function buildMacOSLegacyLaunchAgentPath(homeDir: string): string {
  return `${homeDir}/Library/LaunchAgents/${MACOS_LEGACY_LAUNCH_AGENT_LABEL}.plist`
}

function quoteDesktopExecPath(path: string): string {
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildLinuxAutostartDesktop(executablePath: string, isDev: boolean): string {
  const name = isDev ? 'lich13studio Dev' : 'lich13studio'
  return `[Desktop Entry]
Type=Application
Name=${name}
Comment=A focused desktop AI workspace.
Exec=${quoteDesktopExecPath(executablePath)} ${LOGIN_STARTUP_ARG}
Icon=lich13studio
Terminal=false
StartupNotify=false
Categories=Development;Utility;
X-GNOME-Autostart-enabled=true
Hidden=false`
}
