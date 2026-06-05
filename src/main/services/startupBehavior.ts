export const LOGIN_STARTUP_ARG = '--lich13studio-login-startup'
export const MACOS_LAUNCH_AGENT_LABEL = 'com.lich13.studio'

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

export function getMacOSAppBundlePath(executablePath: string): string {
  const appContentsMarker = '.app/Contents/MacOS/'
  const appContentsIndex = executablePath.indexOf(appContentsMarker)

  if (appContentsIndex === -1) {
    return executablePath
  }

  return executablePath.slice(0, appContentsIndex + '.app'.length)
}

export function buildMacOSLaunchAgentPath(homeDir: string): string {
  return `${homeDir}/Library/LaunchAgents/${MACOS_LAUNCH_AGENT_LABEL}.plist`
}

function escapePlistValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildMacOSLaunchAgentProgramArguments(appPath: string): string[] {
  if (appPath.endsWith('.app')) {
    return ['/usr/bin/open', '-g', appPath, '--args', LOGIN_STARTUP_ARG]
  }

  return [appPath, LOGIN_STARTUP_ARG]
}

export function buildMacOSLaunchAgentPlist(appPath: string): string {
  const args = buildMacOSLaunchAgentProgramArguments(appPath)
    .map((arg) => `        <string>${escapePlistValue(arg)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapePlistValue(MACOS_LAUNCH_AGENT_LABEL)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
`
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
