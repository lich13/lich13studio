import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { backgroundTasks as BackgroundTasksApi } from './BackgroundTaskService'

const native = vi.hoisted(() => ({
  android: true,
  command: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
}))

vi.mock('./runtime', () => ({
  mobileCommand: native.command,
  runtimeCapabilities: {
    get android() {
      return native.android
    }
  }
}))

let backgroundTasks: typeof BackgroundTasksApi
let fixtureWindow: EventTarget
let fixtureDocument: EventTarget & { hidden: boolean }

beforeEach(async () => {
  vi.resetModules()
  native.android = true
  native.command.mockReset().mockImplementation(async (command) => {
    if (command === 'beginTask') return { epoch: 17 }
    if (command === 'endTask') return undefined
    if (command === 'taskState') return {}
    if (command === 'notificationPermission') return { granted: true }
    throw new Error(`Unexpected native command: ${command}`)
  })
  fixtureWindow = new EventTarget()
  fixtureDocument = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', fixtureWindow)
  vi.stubGlobal('document', fixtureDocument)
  backgroundTasks = (await import('./BackgroundTaskService')).backgroundTasks
})

afterEach(() => vi.unstubAllGlobals())

const callsFor = (command: string) => native.command.mock.calls.filter(([name]) => name === command)
const drainMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('backgroundTasks', () => {
  it('keeps the active epoch until the last task is released and ends each task only once', async () => {
    expect(backgroundTasks.getEpoch()).toBeUndefined()
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const firstRelease = await backgroundTasks.acquire(firstStop)
    const secondRelease = await backgroundTasks.acquire(secondStop)
    const beginIds = callsFor('beginTask').map(([, args]) => args?.id)
    expect(new Set(beginIds).size).toBe(2)
    expect(backgroundTasks.getEpoch()).toBe(17)

    firstRelease()
    firstRelease()
    expect(backgroundTasks.getEpoch()).toBe(17)
    expect(callsFor('endTask')).toEqual([['endTask', { id: beginIds[0] }]])
    secondRelease()
    secondRelease()
    expect(backgroundTasks.getEpoch()).toBeUndefined()
    expect(callsFor('endTask').map(([, args]) => args?.id)).toEqual(beginIds)
    expect(firstStop).not.toHaveBeenCalled()
    expect(secondStop).not.toHaveBeenCalled()
    expect(callsFor('notificationPermission')).toHaveLength(1)
  })

  it('requests notification permission only once for concurrent tasks', async () => {
    const releases = await Promise.all([backgroundTasks.acquire(vi.fn()), backgroundTasks.acquire(vi.fn())])
    expect(callsFor('notificationPermission')).toEqual([['notificationPermission', { request: true }]])
    expect(callsFor('beginTask')).toHaveLength(2)
    for (const release of releases) release()
    expect(backgroundTasks.getEpoch()).toBeUndefined()
  })

  it('cancels every active task when stopped from the notification, even if one callback throws', async () => {
    const failedStop = vi.fn(() => {
      throw new Error('Fixture cancellation failure')
    })
    const otherStop = vi.fn()
    const releases = [await backgroundTasks.acquire(failedStop), await backgroundTasks.acquire(otherStop)]
    fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
    expect(failedStop).toHaveBeenCalledTimes(1)
    expect(otherStop).toHaveBeenCalledTimes(1)
    for (const release of releases) release()
    fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
    expect(failedStop).toHaveBeenCalledTimes(1)
    expect(otherStop).toHaveBeenCalledTimes(1)
    expect(backgroundTasks.getEpoch()).toBeUndefined()
  })

  it('checks native task state on return to the foreground and cancels all stopped tasks', async () => {
    const stops = [vi.fn(), vi.fn()]
    const releases = await Promise.all(stops.map((stop) => backgroundTasks.acquire(stop)))
    native.command.mockImplementation(async (command) =>
      command === 'taskState' ? { stoppedReason: 'system-budget' } : undefined
    )
    fixtureDocument.hidden = true
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('taskState')).toHaveLength(0)
    fixtureDocument.hidden = false
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    expect(callsFor('taskState')).toHaveLength(1)
    for (const stop of stops) expect(stop).toHaveBeenCalledExactlyOnceWith('system-budget')
    for (const release of releases) release()
  })

  it('preserves the native stop reason for each active task', async () => {
    const stop = vi.fn()
    const release = await backgroundTasks.acquire(stop)
    fixtureWindow.dispatchEvent(Object.assign(new Event('mobile-tasks-stopped'), { detail: 'system-budget' }))
    expect(stop).toHaveBeenCalledExactlyOnceWith('system-budget')
    release()
  })

  it('keeps tasks active when native state confirms that they are still running', async () => {
    const stop = vi.fn()
    const release = await backgroundTasks.acquire(stop)
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    expect(callsFor('taskState')).toHaveLength(1)
    expect(stop).not.toHaveBeenCalled()
    expect(backgroundTasks.getEpoch()).toBe(17)
    release()
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('taskState')).toHaveLength(1)
  })

  it('ignores foreground reconciliation while a newly authorized task is still starting', async () => {
    let begin!: (value: { epoch: number }) => void
    native.command.mockImplementation(async (command) => {
      if (command === 'beginTask') return new Promise((resolve) => (begin = resolve))
      if (command === 'taskState') return { stoppedReason: 'user-stop' }
    })
    const stop = vi.fn()
    const acquiring = backgroundTasks.acquire(stop)
    await drainMicrotasks()
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    expect(callsFor('taskState')).toHaveLength(0)
    expect(stop).not.toHaveBeenCalled()
    begin({ epoch: 18 })
    const release = await acquiring
    expect(backgroundTasks.getEpoch()).toBe(18)
    expect(stop).not.toHaveBeenCalled()
    release()
  })

  it('does not let a stale foreground reply stop a replacement task', async () => {
    let reconcile!: (value: { stoppedReason: string }) => void
    const oldRelease = await backgroundTasks.acquire(vi.fn())
    native.command.mockImplementation(async (command) => {
      if (command === 'beginTask') return { epoch: 17 }
      if (command === 'taskState') return new Promise((resolve) => (reconcile = resolve))
    })
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    oldRelease()
    const newStop = vi.fn()
    const newRelease = await backgroundTasks.acquire(newStop)
    reconcile({ stoppedReason: 'user-stop' })
    await drainMicrotasks()
    expect(newStop).not.toHaveBeenCalled()
    newRelease()
  })

  it('cancels tasks when foreground reconciliation cannot read native state', async () => {
    const stops = [vi.fn(), vi.fn()]
    const releases = await Promise.all(stops.map((stop) => backgroundTasks.acquire(stop)))
    native.command.mockRejectedValueOnce(new Error('Fixture task state unavailable'))
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1)
    for (const release of releases) release()
  })

  it.each(['denied', 'failed', 'unanswered'])(
    'starts and releases the task when notification permission is %s',
    async (permission) => {
      const handler = native.command.getMockImplementation()!
      let answer!: (value: unknown) => void
      native.command.mockImplementation(async (command, args) => {
        if (command !== 'notificationPermission') return handler(command, args)
        if (permission === 'failed') throw new Error('Permission callback unavailable')
        if (permission === 'denied') return { granted: false }
        return new Promise((resolve) => (answer = resolve))
      })
      const stop = vi.fn()
      const release = await backgroundTasks.acquire(stop)
      expect(callsFor('beginTask')).toHaveLength(1)
      expect(backgroundTasks.getEpoch()).toBe(17)
      fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
      expect(stop).toHaveBeenCalledTimes(1)
      release()
      expect(callsFor('endTask')).toHaveLength(1)
      expect(backgroundTasks.getEpoch()).toBeUndefined()
      answer?.({ granted: true })
      await drainMicrotasks()
      expect(callsFor('beginTask')).toHaveLength(1)
      expect(backgroundTasks.getEpoch()).toBeUndefined()
    }
  )

  it('propagates service startup failure without leaving an active task or cancellation callback', async () => {
    const stop = vi.fn()
    native.command.mockRejectedValueOnce(new Error('Fixture foreground service refused'))
    await expect(backgroundTasks.acquire(stop)).rejects.toThrow('Fixture foreground service refused')
    expect(backgroundTasks.getEpoch()).toBeUndefined()
    fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
    expect(stop).not.toHaveBeenCalled()
    expect(callsFor('endTask')).toHaveLength(0)
    const release = await backgroundTasks.acquire(vi.fn())
    expect(backgroundTasks.getEpoch()).toBe(17)
    release()
  })

  it('leaves another active task registered when a later startup fails', async () => {
    const firstStop = vi.fn()
    const failedStop = vi.fn()
    const firstRelease = await backgroundTasks.acquire(firstStop)
    native.command.mockRejectedValueOnce(new Error('Fixture second startup refused'))
    await expect(backgroundTasks.acquire(failedStop)).rejects.toThrow('Fixture second startup refused')
    expect(backgroundTasks.getEpoch()).toBe(17)
    fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(failedStop).not.toHaveBeenCalled()
    firstRelease()
  })

  it('does not initialize permissions or native background services on desktop', async () => {
    native.android = false
    const stop = vi.fn()
    const release = await backgroundTasks.acquire(stop)
    release()
    release()
    fixtureWindow.dispatchEvent(new Event('mobile-tasks-stopped'))
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(backgroundTasks.getEpoch()).toBeUndefined()
    expect(native.command).not.toHaveBeenCalled()
    expect(callsFor('notificationPermission')).toHaveLength(0)
    expect(stop).not.toHaveBeenCalled()
  })
})
