import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'

import { mobileCommand, runtimeCapabilities } from './runtime'

const tasks = new Map<string, (reason?: string) => void>()
let epoch = 0
let initialized = false
let notificationPermission: Promise<void> | undefined
function cancelAll(reason: string) {
  for (const stop of [...tasks.values()]) {
    try {
      stop(reason)
    } catch {
      /* isolate callbacks */
    }
  }
}
export const backgroundTasks = {
  getEpoch: () => (runtimeCapabilities.android && tasks.size ? epoch : undefined),
  async acquire(stop: (reason?: string) => void) {
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
      window.addEventListener('mobile-tasks-stopped', (event) => {
        const reason = (event as CustomEvent<unknown>).detail
        cancelAll(typeof reason === 'string' ? reason : 'service-stopped')
      })
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && tasks.size)
          void mobileCommand<{ stoppedReason?: string }>('taskState')
            .then((state) => {
              if (state.stoppedReason) cancelAll(state.stoppedReason)
            })
            .catch(() => cancelAll('service-stopped'))
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
