import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  android: false,
  getEpoch: vi.fn((): number | undefined => 73),
  warn: vi.fn()
}))
vi.mock('@renderer/services/mobile/BackgroundTaskService', () => ({
  backgroundTasks: { getEpoch: fixture.getEpoch }
}))
vi.mock('@renderer/services/mobile/runtime', () => ({
  runtimeCapabilities: {
    get android() {
      return fixture.android
    }
  }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: fixture.warn }) } }))

import { getTauriNativeFetch } from './tauriNativeFetch'

type NativeRequest = {
  requestId: string
  url: string
  method: string
  headers: { name: string; value: string }[]
  body?: number[]
  bodyBase64?: string
  bodyText?: string
  taskEpoch?: number
}
type ResponseStart = {
  requestId: string
  status: number
  statusText: string
  headers: { name: string; value: string }[]
}
type Chunk = { requestId: string; sequence: number; chunk: string | number[]; done: boolean; error?: string }
type Listener = (event: { payload: Chunk }) => void

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const fixtureUrl = 'https://transport-fixture.invalid/v1/chat/completions'
const encoder = new TextEncoder()
const responseStart = (requestId: string): ResponseStart => ({
  requestId,
  status: 200,
  statusText: 'OK',
  headers: [{ name: 'content-type', value: 'text/event-stream' }]
})
const chunk = (requestId: string, sequence: number, text = '', done = false, error?: string): Chunk => ({
  requestId,
  sequence,
  chunk: [...encoder.encode(text)],
  done,
  ...(error ? { error } : {})
})

let fixtureDocument: EventTarget & { hidden: boolean }
let activeListeners: Set<Listener>
let requests: NativeRequest[]
let unlisteners: ReturnType<typeof vi.fn>[]
let startReply: (request: NativeRequest) => Promise<ResponseStart>
let replayReply: (requestId: string) => Promise<Chunk[]>
let abortReply: (requestId: string) => Promise<void>
let invoke: ReturnType<typeof vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>>
let listen: ReturnType<typeof vi.fn<(event: string, handler: Listener) => Promise<() => void>>>
let fallbackFetch: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  fixture.android = false
  fixture.getEpoch.mockReset().mockReturnValue(73)
  fixture.warn.mockClear()
  activeListeners = new Set()
  requests = []
  unlisteners = []
  startReply = async (request) => responseStart(request.requestId)
  replayReply = async () => []
  abortReply = async () => {}
  invoke = vi.fn(async (command, args) => {
    if (command === 'start_http_request') {
      const request = args?.request as NativeRequest
      requests.push(request)
      return startReply(request)
    }
    if (command === 'replay_http_chunks') return replayReply(args?.requestId as string)
    if (command === 'acknowledge_http_chunks') return undefined
    if (command === 'abort_http_request') return abortReply(args?.requestId as string)
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
  listen = vi.fn(async (event, handler) => {
    if (event !== 'native_http_chunk') throw new Error(`Unexpected event channel: ${event}`)
    activeListeners.add(handler)
    const unlisten = vi.fn(() => {
      activeListeners.delete(handler)
    })
    unlisteners.push(unlisten)
    return unlisten
  })
  fallbackFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected real fetch'))
  fixtureDocument = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', { __TAURI__: { core: { invoke }, event: { listen } } })
  vi.stubGlobal('document', fixtureDocument)
  vi.stubGlobal('fetch', fallbackFetch)
})

afterEach(() => {
  expect(fallbackFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

const callsFor = (command: string) => invoke.mock.calls.filter(([name]) => name === command)
const emit = (payload: Chunk) => {
  for (const listener of [...activeListeners]) listener({ payload })
}
const nativeFetch = (init?: RequestInit) => getTauriNativeFetch()!(fixtureUrl, init)

describe('Tauri native fetch delivery', () => {
  it('preserves an explicit User-Agent and other headers when Chromium Request drops User-Agent', async () => {
    const OriginalRequest = globalThis.Request
    const constructedHeaders: Headers[] = []
    class ChromiumRequest extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init)
        this.headers.delete('User-Agent')
        constructedHeaders.push(new Headers(this.headers))
      }
    }
    vi.stubGlobal('Request', ChromiumRequest)
    const response = await nativeFetch({
      method: 'POST',
      headers: {
        'User-Agent': 'fixture-cli/1.2.3',
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Fixture-Trace': 'fixture-trace'
      },
      body: '{"model":"fixture-model"}'
    })
    expect(constructedHeaders).toHaveLength(1)
    expect(constructedHeaders[0].get('user-agent')).toBeNull()
    const forwarded = new Headers(requests[0].headers.map(({ name, value }) => [name, value]))
    expect(forwarded.get('user-agent')).toBe('fixture-cli/1.2.3')
    expect(forwarded.get('content-type')).toBe('application/json')
    expect(forwarded.get('accept')).toBe('text/event-stream')
    expect(forwarded.get('x-fixture-trace')).toBe('fixture-trace')
    emit(chunk(requests[0].requestId, 1, 'fixture response', true))
    expect(await response.text()).toBe('fixture response')
  })

  it('uses the native request contract and buffers sequenced data delivered before the response headers', async () => {
    const headers = deferred<ResponseStart>()
    const started = deferred<NativeRequest>()
    startReply = async (request) => {
      started.resolve(request)
      return headers.promise
    }
    const body = JSON.stringify({ model: 'fixture-model', messages: [{ role: 'user', content: 'fixture' }] })
    const pending = nativeFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fixture': 'yes' },
      body
    })
    const request = await started.promise
    emit(chunk(request.requestId, 1, 'before '))
    emit(chunk(request.requestId, 2, 'headers', true))
    headers.resolve({ ...responseStart(request.requestId), status: 201, statusText: 'Created' })
    const response = await pending
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('before headers')
    expect(request).toMatchObject({ url: fixtureUrl, method: 'POST', taskEpoch: 73 })
    expect(request.bodyText).toBe(body)
    expect(request.body).toBeUndefined()
    expect(request.headers).toContainEqual({ name: 'x-fixture', value: 'yes' })
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
  })

  it('forwards binary Uint8Array request bodies as compact base64 strings', async () => {
    const binaryPayload = new Uint8Array([0, 159, 255, 42])
    const response = await nativeFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: binaryPayload
    })
    expect(requests[0].bodyBase64).toBe(btoa(String.fromCharCode(0, 159, 255, 42)))
    expect(requests[0].body).toBeUndefined()
    expect(requests[0].bodyText).toBeUndefined()
    emit(chunk(requests[0].requestId, 1, 'ok', true))
    expect(await response.text()).toBe('ok')
  })

  it('scopes desktop chunk listener to current WebviewWindow label and skips visibilitychange replay on desktop', async () => {
    const windowListen = vi.fn((event: string, handler: Listener) => listen(event, handler))
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'mini' } } },
      __TAURI__: {
        core: { invoke },
        event: { listen },
        webviewWindow: {
          getCurrentWebviewWindow: () => ({ label: 'mini', listen: windowListen })
        }
      }
    })
    const response = await nativeFetch()
    const id = requests[0].requestId
    expect(windowListen).toHaveBeenCalledTimes(1)
    fixtureDocument.hidden = false
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('replay_http_chunks')).toHaveLength(0)
    emit(chunk(id, 1, 'scoped', true))
    expect(await response.text()).toBe('scoped')
  })

  it('merges out-of-order live and replayed events without losing or repeating text', async () => {
    const replay = deferred<Chunk[]>()
    replayReply = () => replay.promise
    const response = await nativeFetch()
    const id = requests[0].requestId
    emit(chunk(id, 3, 'C'))
    emit(chunk(id, 3, 'C'))
    emit(chunk(id, 1, 'A'))
    emit(chunk(id, 1, 'A'))
    expect(callsFor('replay_http_chunks')).toHaveLength(1)
    expect(callsFor('acknowledge_http_chunks').map(([, args]) => args?.sequence)).not.toContain(3)
    replay.resolve([chunk(id, 1, 'A'), chunk(id, 2, 'B'), chunk(id, 3, 'C'), chunk(id, 4, 'D', true)])
    expect(await response.text()).toBe('ABCD')
    expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]).toEqual({ requestId: id, sequence: 4 })
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(activeListeners.size).toBe(0)
  })

  it('preserves UTF-8 bytes split across reordered chunks', async () => {
    const response = await nativeFetch()
    const id = requests[0].requestId
    const bytes = [...encoder.encode('回答🙂完成')]
    emit({ requestId: id, sequence: 2, chunk: bytes.slice(2, 7), done: false })
    emit({ requestId: id, sequence: 1, chunk: bytes.slice(0, 2), done: false })
    emit({ requestId: id, sequence: 3, chunk: bytes.slice(7), done: true })
    expect(await response.text()).toBe('回答🙂完成')
  })

  it('replays missed foreground events and suppresses duplicate replay requests while one is pending', async () => {
    fixture.android = true
    const replay = deferred<Chunk[]>()
    replayReply = () => replay.promise
    const response = await nativeFetch()
    const id = requests[0].requestId
    emit(chunk(id, 1, 'first '))
    fixtureDocument.hidden = true
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('replay_http_chunks')).toHaveLength(0)
    fixtureDocument.hidden = false
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('replay_http_chunks')).toHaveLength(1)
    replay.resolve([chunk(id, 1, 'first '), chunk(id, 2, 'second'), chunk(id, 3, '', true)])
    expect(await response.text()).toBe('first second')
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('replay_http_chunks')).toHaveLength(1)
  })

  it('isolates interleaved sequenced events from concurrent requests', async () => {
    const [first, second] = await Promise.all([nativeFetch(), nativeFetch()])
    const [firstId, secondId] = requests.map(({ requestId }) => requestId)
    expect(firstId).not.toBe(secondId)
    emit(chunk('unrelated-request', 1, 'ignore', true))
    emit(chunk(secondId, 2, 'two', true))
    emit(chunk(firstId, 1, 'first'))
    emit(chunk(secondId, 1, 'second-'))
    emit(chunk(firstId, 2, '-one', true))
    expect(await first.text()).toBe('first-one')
    expect(await second.text()).toBe('second-two')
    expect(activeListeners.size).toBe(0)
    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('does not start a native request with an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(nativeFetch({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(listen).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('aborts an active body once and ignores late replay completion', async () => {
    const replay = deferred<Chunk[]>()
    replayReply = () => replay.promise
    const controller = new AbortController()
    const response = await nativeFetch({ signal: controller.signal })
    const id = requests[0].requestId
    emit(chunk(id, 2, 'late'))
    const body = response.text()
    controller.abort()
    controller.abort()
    await expect(body).rejects.toMatchObject({ name: 'AbortError' })
    replay.resolve([chunk(id, 1, 'ignored'), chunk(id, 2, 'late'), chunk(id, 3, '', true)])
    await replay.promise
    await Promise.resolve()
    expect(callsFor('abort_http_request')).toEqual([['abort_http_request', { requestId: id }]])
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(activeListeners.size).toBe(0)
    expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]?.sequence).toBe(0)
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('replay_http_chunks')).toHaveLength(1)
  })

  it('cancels the native request when the response reader is cancelled', async () => {
    const response = await nativeFetch()
    const reader = response.body!.getReader()
    await reader.cancel('fixture consumer stopped')
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(callsFor('abort_http_request')).toEqual([['abort_http_request', { requestId: requests[0].requestId }]])
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(activeListeners.size).toBe(0)
  })

  it('reports cancellation during connection as AbortError and releases the listener', async () => {
    const headers = deferred<ResponseStart>()
    const started = deferred<NativeRequest>()
    startReply = async (request) => {
      started.resolve(request)
      return headers.promise
    }
    abortReply = async () => {
      headers.reject(new Error('Fixture native connection cancelled'))
    }
    const controller = new AbortController()
    const pending = nativeFetch({ signal: controller.signal })
    const request = await started.promise
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(callsFor('abort_http_request')).toEqual([['abort_http_request', { requestId: request.requestId }]])
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(activeListeners.size).toBe(0)
  })

  it('makes a failed native connection terminal and removes abort and visibility listeners', async () => {
    startReply = async () => {
      throw new Error('Fixture native connection refused')
    }
    const controller = new AbortController()
    await expect(nativeFetch({ signal: controller.signal })).rejects.toThrow('Fixture native connection refused')
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(activeListeners.size).toBe(0)
    controller.abort()
    fixtureDocument.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor('abort_http_request')).toHaveLength(0)
    expect(callsFor('replay_http_chunks')).toHaveLength(0)
  })

  it('delivers preceding bytes in order and rejects the reader at an ordered native error', async () => {
    const response = await nativeFetch()
    const id = requests[0].requestId
    const reader = response.body!.getReader()
    const first = reader.read()
    emit(chunk(id, 1, 'first'))
    expect(new TextDecoder().decode((await first).value)).toBe('first')
    const second = reader.read()
    emit(chunk(id, 3, '', true, 'Fixture connection reset'))
    emit(chunk(id, 2, 'second'))
    expect(new TextDecoder().decode((await second).value)).toBe('second')
    await expect(reader.read()).rejects.toThrow('Fixture connection reset')
    expect(unlisteners[0]).toHaveBeenCalledTimes(1)
    expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]?.sequence).toBe(3)
    emit(chunk(id, 4, 'must not reopen', true))
    await expect(reader.read()).rejects.toThrow('Fixture connection reset')
  })

  it('does not expose the native adapter when Tauri APIs are unavailable', () => {
    vi.stubGlobal('window', {})
    expect(getTauriNativeFetch()).toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
  })

  it('decodes Base64-serialized chunks and shares a single event listener across concurrent requests', async () => {
    const [first, second] = await Promise.all([nativeFetch(), nativeFetch()])
    expect(listen).toHaveBeenCalledTimes(1)
    const [firstId, secondId] = requests.map(({ requestId }) => requestId)
    emit({ requestId: firstId, sequence: 1, chunk: btoa('hello '), done: false })
    emit({ requestId: secondId, sequence: 1, chunk: btoa('world'), done: true })
    emit({ requestId: firstId, sequence: 2, chunk: btoa('base64'), done: true })
    expect(await first.text()).toBe('hello base64')
    expect(await second.text()).toBe('world')
    expect(activeListeners.size).toBe(0)
  })

  it('batches acknowledge_http_chunks by 8 chunks, 64 KiB, 25ms timer, and immediate terminal flush', async () => {
    vi.useFakeTimers()
    try {
      const response = await nativeFetch()
      const id = requests[0].requestId

      // 3 small chunks: no immediate ACK before 25ms
      emit(chunk(id, 1, 'a'))
      emit(chunk(id, 2, 'b'))
      emit(chunk(id, 3, 'c'))
      expect(callsFor('acknowledge_http_chunks')).toHaveLength(0)

      // After 25ms timer: flushes sequence 3 once
      await vi.advanceTimersByTimeAsync(25)
      expect(callsFor('acknowledge_http_chunks')).toEqual([['acknowledge_http_chunks', { requestId: id, sequence: 3 }]])

      // 8 more chunks (sequences 4..11): flushes immediately on 8th chunk without timer
      for (let seq = 4; seq <= 10; seq += 1) {
        emit(chunk(id, seq, 'x'))
      }
      expect(callsFor('acknowledge_http_chunks')).toHaveLength(1)
      emit(chunk(id, 11, 'x'))
      expect(callsFor('acknowledge_http_chunks')).toHaveLength(2)
      expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]).toEqual({ requestId: id, sequence: 11 })

      // Single >= 64 KiB chunk (sequence 12): flushes immediately
      emit({ requestId: id, sequence: 12, chunk: new Array(65536).fill(65), done: false })
      expect(callsFor('acknowledge_http_chunks')).toHaveLength(3)
      expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]).toEqual({ requestId: id, sequence: 12 })

      // Terminal done chunk (sequence 13): flushes immediately
      emit(chunk(id, 13, '!', true))
      expect(callsFor('acknowledge_http_chunks')).toHaveLength(4)
      expect(callsFor('acknowledge_http_chunks').at(-1)?.[1]).toEqual({ requestId: id, sequence: 13 })

      const text = await response.text()
      expect(text.startsWith('abcxxxxxxxx')).toBe(true)
      expect(text.endsWith('!')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
