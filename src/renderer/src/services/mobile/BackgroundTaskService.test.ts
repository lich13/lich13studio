import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  android: true,
  command: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  isPermissionGranted: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<() => Promise<'granted' | 'denied' | 'default'>>()
}))

vi.mock('./runtime', () => ({
  mobileCommand: native.command,
  runtimeCapabilities: {
    get android() {
      return native.android
    }
  }
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: native.isPermissionGranted,
  requestPermission: native.requestPermission
}))

let backgroundTasks: typeof import('./BackgroundTaskService')['backgroundTasks']
let fixtureWindow: EventTarget
let fixtureDocument: EventTarget & { hidden: boolean }

beforeEach(async () => {
  vi.resetModules()
  native.android = true
  native.isPermissionGranted.mockReset().mockResolvedValue(true)
  native.requestPermission.mockReset().mockResolvedValue('granted')
  native.command.mockReset().mockImplementation(async (command) => {
    if (command === 'beginTask') return { epoch: 17 }
    if (command === 'endTask') return undefined
    if (command === 'taskState') return {}
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
    expect(native.requestPermission).not.toHaveBeenCalled()
  })

  it('requests notification permission only once for concurrent tasks', async () => {
    native.isPermissionGranted.mockResolvedValue(false)
    const releases = await Promise.all([backgroundTasks.acquire(vi.fn()), backgroundTasks.acquire(vi.fn())])
    expect(native.isPermissionGranted).toHaveBeenCalledTimes(1)
    expect(native.requestPermission).toHaveBeenCalledTimes(1)
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

  it('cancels tasks when foreground reconciliation cannot read native state', async () => {
    const stops = [vi.fn(), vi.fn()]
    const releases = await Promise.all(stops.map((stop) => backgroundTasks.acquire(stop)))
    native.command.mockRejectedValueOnce(new Error('Fixture task state unavailable'))
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    await drainMicrotasks()
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1)
    for (const release of releases) release()
  })

  it.each(['denied', 'query failed', 'request failed'])(
    'does not strand the task when notification permission is %s',
    async (failure) => {
      native.isPermissionGranted.mockResolvedValue(false)
      if (failure === 'denied') native.requestPermission.mockResolvedValue('denied')
      if (failure === 'query failed')
        native.isPermissionGranted.mockRejectedValue(new Error('Fixture permission query failed'))
      if (failure === 'request failed')
        native.requestPermission.mockRejectedValue(new Error('Fixture permission request failed'))
      const release = await backgroundTasks.acquire(vi.fn())
      expect(callsFor('beginTask')).toHaveLength(1)
      expect(backgroundTasks.getEpoch()).toBe(17)
      release()
      expect(callsFor('endTask')).toHaveLength(1)
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
    expect(native.isPermissionGranted).not.toHaveBeenCalled()
    expect(native.requestPermission).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })
})
