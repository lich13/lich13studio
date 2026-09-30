import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'

import { mobileCommand, runtimeCapabilities } from './runtime'

const tasks = new Map<string, () => void>()
let epoch = 0
let initialized = false
let notificationPermission: Promise<void> | undefined
function cancelAll() {
  for (const stop of [...tasks.values()]) {
    try {
      stop()
    } catch {
      /* isolate callbacks */
    }
  }
}
export const backgroundTasks = {
  getEpoch: () => (runtimeCapabilities.android && tasks.size ? epoch : undefined),
  async acquire(stop: () => void) {
    if (!runtimeCapabilities.android) return () => {}
    // Request only in response to the user's first task, before entering background.
    notificationPermission ??= isPermissionGranted()
      .then(async (granted) => {
        if (!granted) await requestPermission()
      })
      .catch(() => {})
    await notificationPermission
    if (!initialized) {
      initialized = true
      window.addEventListener('mobile-tasks-stopped', cancelAll)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && tasks.size)
          void mobileCommand<{ stoppedReason?: string }>('taskState')
            .then((state) => {
              if (state.stoppedReason) cancelAll()
            })
            .catch(cancelAll)
      })
    }
    const id = crypto.randomUUID()
    tasks.set(id, stop)
    try {
      const result = await mobileCommand<{ epoch: number }>('beginTask', { id })
      epoch = result.epoch
    } catch (error) {
      tasks.delete(id)
      throw error
    }
    let released = false
    return () => {
      if (released) return
      released = true
      tasks.delete(id)
      void mobileCommand('endTask', { id }).catch(() => {})
    }
  }
}
