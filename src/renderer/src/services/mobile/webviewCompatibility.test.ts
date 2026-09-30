import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installWebviewCompatibility } from './webviewCompatibility'

function propertyOwner(target: object, key: PropertyKey): object {
  let owner: object | null = target
  while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) owner = Object.getPrototypeOf(owner)
  if (!owner) throw new Error(`Fixture platform has no ${String(key)}`)
  return owner
}

const uuidOwner = propertyOwner(globalThis.crypto, 'randomUUID')
const slots = [
  { target: AbortController.prototype, key: 'abort' },
  { target: AbortSignal.prototype, key: 'reason' },
  { target: AbortSignal.prototype, key: 'throwIfAborted' },
  { target: AbortSignal, key: 'any' },
  { target: AbortSignal, key: 'timeout' },
  { target: globalThis.crypto, key: 'randomUUID' },
  ...(uuidOwner === globalThis.crypto ? [] : [{ target: uuidOwner, key: 'randomUUID' }])
]
let originals: Array<{ target: object; key: string; descriptor: PropertyDescriptor | undefined }>

beforeEach(() => {
  originals = slots.map(({ target, key }) => ({
    target,
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key)
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const { target, key, descriptor } of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
})

function removeCompatibilityApis() {
  for (const { target, key } of slots) {
    if (key !== 'abort') expect(Reflect.deleteProperty(target, key)).toBe(true)
  }
  expect('reason' in AbortSignal.prototype).toBe(false)
  expect(AbortSignal.prototype.throwIfAborted).toBeUndefined()
  expect(AbortSignal.any).toBeUndefined()
  expect(AbortSignal.timeout).toBeUndefined()
  expect(crypto.randomUUID).toBeUndefined()
}

function installOnLegacyPlatform() {
  removeCompatibilityApis()
  installWebviewCompatibility()
}

describe('WebView compatibility', () => {
  it('installs missing APIs when the module is first loaded', async () => {
    removeCompatibilityApis()
    vi.resetModules()
    await import('./webviewCompatibility')
    expect('reason' in AbortSignal.prototype).toBe(true)
    expect(AbortSignal.prototype.throwIfAborted).toBeTypeOf('function')
    expect(AbortSignal.any).toBeTypeOf('function')
    expect(AbortSignal.timeout).toBeTypeOf('function')
    expect(crypto.randomUUID).toBeTypeOf('function')
  })

  it('preserves every existing API and property descriptor', () => {
    installWebviewCompatibility()
    installWebviewCompatibility()
    for (const { target, key, descriptor } of originals) {
      expect(Object.getOwnPropertyDescriptor(target, key)).toEqual(descriptor)
    }
  })

  it('only fills a missing API while keeping existing abort behavior and UUID intact', () => {
    const preserved = originals.filter(({ key }) => key !== 'timeout')
    Reflect.deleteProperty(AbortSignal, 'timeout')
    installWebviewCompatibility()
    expect(AbortSignal.timeout).toBeTypeOf('function')
    for (const { target, key, descriptor } of preserved) {
      expect(Object.getOwnPropertyDescriptor(target, key)).toEqual(descriptor)
    }
  })

  it('does not replace its installed APIs or lose reasons when installed again', () => {
    installOnLegacyPlatform()
    const installed = slots.map(({ target, key }) => Object.getOwnPropertyDescriptor(target, key))
    const controller = new AbortController()
    const reason = new Error('fixture cancellation')
    controller.abort(reason)
    installWebviewCompatibility()
    slots.forEach(({ target, key }, index) =>
      expect(Object.getOwnPropertyDescriptor(target, key)).toEqual(installed[index])
    )
    expect(controller.signal.reason).toBe(reason)
  })

  it('leaves a pending signal without a reason and does not throw', () => {
    installOnLegacyPlatform()
    const signal = new AbortController().signal
    expect(signal.aborted).toBe(false)
    expect(signal.reason).toBeUndefined()
    expect(() => signal.throwIfAborted()).not.toThrow()
  })

  it('creates a stable AbortError for cancellation without a supplied reason', () => {
    installOnLegacyPlatform()
    const controller = new AbortController()
    controller.abort()
    const reason = controller.signal.reason
    expect(controller.signal.aborted).toBe(true)
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('AbortError')
    expect(controller.signal.reason).toBe(reason)
    expect(() => controller.signal.throwIfAborted()).toThrow(reason)
  })

  it.each([
    { label: 'Error', reason: new Error('fixture reason') },
    { label: 'object', reason: { source: 'fixture caller' } },
    { label: 'string', reason: 'fixture cancellation' },
    { label: 'null', reason: null },
    { label: 'false', reason: false },
    { label: 'zero', reason: 0 },
    { label: 'empty string', reason: '' }
  ])('preserves and throws an explicit $label cancellation reason', ({ reason }) => {
    installOnLegacyPlatform()
    const controller = new AbortController()
    const observed: unknown[] = []
    controller.signal.addEventListener('abort', () => observed.push(controller.signal.reason))
    controller.abort(reason)
    expect(controller.signal.reason).toBe(reason)
    expect(observed).toEqual([reason])
    let thrown: unknown = Symbol('not thrown')
    try {
      controller.signal.throwIfAborted()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(reason)
  })

  it('keeps the first reason and emits cancellation only once', () => {
    installOnLegacyPlatform()
    const controller = new AbortController()
    const stopped = vi.fn()
    controller.signal.addEventListener('abort', stopped)
    controller.abort('first cancellation')
    controller.abort('later cancellation')
    expect(controller.signal.reason).toBe('first cancellation')
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('recognizes a signal that was already aborted before compatibility was installed', () => {
    removeCompatibilityApis()
    const controller = new AbortController()
    controller.abort()
    installWebviewCompatibility()
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toMatchObject({ name: 'AbortError' })
    const firstReason = controller.signal.reason
    expect(controller.signal.reason).toBe(firstReason)
    expect(() => controller.signal.throwIfAborted()).toThrow(firstReason)
  })

  it('propagates the first combined cancellation and releases all source listeners', () => {
    installOnLegacyPlatform()
    const first = new AbortController()
    const second = new AbortController()
    const firstRemoval = vi.spyOn(first.signal, 'removeEventListener')
    const secondRemoval = vi.spyOn(second.signal, 'removeEventListener')
    const combined = AbortSignal.any([first.signal, second.signal])
    const stopped = vi.fn()
    combined.addEventListener('abort', stopped)
    const reason = new Error('fixture second source stopped')
    second.abort(reason)
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBe(reason)
    expect(first.signal.aborted).toBe(false)
    expect(firstRemoval).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(secondRemoval).toHaveBeenCalledWith('abort', expect.any(Function))
    first.abort('later source stopped')
    expect(combined.reason).toBe(reason)
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('immediately uses a pre-aborted source, including an explicit null reason', () => {
    installOnLegacyPlatform()
    const pending = new AbortController()
    const cancelled = new AbortController()
    const unused = new AbortController()
    cancelled.abort(null)
    const pendingRemoval = vi.spyOn(pending.signal, 'removeEventListener')
    const unusedListener = vi.spyOn(unused.signal, 'addEventListener')
    const combined = AbortSignal.any([pending.signal, cancelled.signal, unused.signal])
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBeNull()
    expect(pendingRemoval).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(unusedListener).not.toHaveBeenCalled()
    pending.abort('later')
    expect(combined.reason).toBeNull()
  })

  it('uses the first pre-aborted source in input order', () => {
    installOnLegacyPlatform()
    const first = new AbortController()
    const second = new AbortController()
    first.abort('first')
    second.abort('second')
    expect(AbortSignal.any([first.signal, second.signal]).reason).toBe('first')
  })

  it('does not schedule implicit timeouts for ordinary or combined signals', () => {
    installOnLegacyPlatform()
    vi.useFakeTimers()
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal])
    const empty = AbortSignal.any([])
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000)
    expect(controller.signal.aborted).toBe(false)
    expect(combined.aborted).toBe(false)
    expect(empty.aborted).toBe(false)
  })

  it('times out only explicitly timed signals and propagates TimeoutError to dependent signals', () => {
    installOnLegacyPlatform()
    vi.useFakeTimers()
    const ordinary = new AbortController()
    const timeout = AbortSignal.timeout(50)
    const combined = AbortSignal.any([ordinary.signal, timeout])
    vi.advanceTimersByTime(49)
    expect(timeout.aborted).toBe(false)
    expect(combined.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(timeout.aborted).toBe(true)
    expect(timeout.reason).toBeInstanceOf(DOMException)
    expect(timeout.reason.name).toBe('TimeoutError')
    expect(combined.reason).toBe(timeout.reason)
    expect(ordinary.signal.aborted).toBe(false)
    expect(() => timeout.throwIfAborted()).toThrow(timeout.reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('schedules zero-delay timeout asynchronously', () => {
    installOnLegacyPlatform()
    vi.useFakeTimers()
    const signal = AbortSignal.timeout(0)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(0)
    expect(signal.aborted).toBe(true)
    expect(signal.reason.name).toBe('TimeoutError')
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid timeout %s without scheduling work',
    (delay) => {
      installOnLegacyPlatform()
      vi.useFakeTimers()
      expect(() => AbortSignal.timeout(delay)).toThrow(RangeError)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('produces distinct RFC 4122 version 4 UUIDs using cryptographic randomness', () => {
    installOnLegacyPlatform()
    const entropy = vi.spyOn(crypto, 'getRandomValues')
    const identifiers = Array.from({ length: 64 }, () => crypto.randomUUID())
    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    }
    expect(new Set(identifiers).size).toBe(identifiers.length)
    expect(entropy).toHaveBeenCalled()
  })
})
