type MainProcessSettingUpdate = [key: string, value: boolean]

const MAIN_PROCESS_SETTING_KEYS = new Set(['launchToTray', 'tray', 'trayOnClose'])

export function isMainProcessSettingKey(key: string): boolean {
  return MAIN_PROCESS_SETTING_KEYS.has(key)
}

export function getMainProcessSettingUpdates(updates: {
  launchToTray?: boolean
  tray?: boolean
  trayOnClose?: boolean
}): MainProcessSettingUpdate[] {
  const next: MainProcessSettingUpdate[] = []

  if (updates.launchToTray !== undefined) {
    next.push(['launchToTray', updates.launchToTray])
    if (updates.launchToTray) {
      next.push(['tray', true])
    }
  }

  if (updates.trayOnClose !== undefined) {
    next.push(['trayOnClose', updates.trayOnClose])
    if (updates.trayOnClose) {
      next.push(['tray', true])
    }
  }

  if (updates.tray !== undefined && !next.some(([key]) => key === 'tray')) {
    next.push(['tray', updates.tray])
  }

  return next
}
