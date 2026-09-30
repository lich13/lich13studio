import { mobileCommand, runtimeCapabilities } from './runtime'

type Task = { stop: (reason?: string) => void; nativeStarted: boolean }
const tasks = new Map<string, Task>()
let epoch = 0
let initialized = false
let notificationRequested = false
function cancelAll(reason: string) {
  for (const { stop } of [...tasks.values()]) {
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
    if (!initialized) {
      initialized = true
      window.addEventListener('mobile-tasks-stopped', (event) => {
        const reason = (event as CustomEvent<unknown>).detail
        cancelAll(typeof reason === 'string' ? reason : 'service-stopped')
      })
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return
        // A permission dialog may return while beginTask is still queued.
        // Its old stoppedReason must not cancel a task that has not started.
        const active = [...tasks.entries()].filter(([, task]) => task.nativeStarted)
        if (!active.length) return
        const observedEpoch = epoch
        const stopObserved = (reason: string) => {
          if (epoch !== observedEpoch) return
          for (const [id, task] of active) {
            if (tasks.get(id) !== task) continue
            try {
              task.stop(reason)
            } catch {
              /* isolate callbacks */
            }
          }
        }
        void mobileCommand<{ stoppedReason?: string }>('taskState')
          .then((state) => {
            if (state.stoppedReason) stopObserved(state.stoppedReason)
          })
          .catch(() => stopObserved('service-stopped'))
      })
    }
    const id = crypto.randomUUID()
    const task = { stop, nativeStarted: false }
    tasks.set(id, task)
    try {
      const result = await mobileCommand<{ epoch: number }>('beginTask', { id })
      epoch = result.epoch
      task.nativeStarted = true
      // POST_NOTIFICATIONS is not required to start an Android foreground service.
      // Never gate a model request or its cancellation on the permission dialog.
      if (!notificationRequested) {
        notificationRequested = true
        void mobileCommand('notificationPermission', { request: true }).catch(() => {})
      }
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
