type MainProcessSettingUpdate = [key: string, value: boolean]

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
