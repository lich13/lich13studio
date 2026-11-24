import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { backgroundTasks } from '@renderer/services/mobile/BackgroundTaskService'

const logger = loggerService.withContext('TauriNativeFetch')
const textEncoder = new TextEncoder()

type TauriListenEvent = {
  payload: NativeHttpChunkEvent
}

type NativeHttpHeader = {
  name: string
  value: string
}

type NativeHttpRequest = {
  requestId: string
  url: string
  method: string
  headers: NativeHttpHeader[]
  body?: number[]
  taskEpoch?: number
}

type NativeHttpResponseStart = {
  requestId: string
  status: number
  statusText: string
  headers: NativeHttpHeader[]
}

type NativeHttpChunkEvent = {
  sequence?: number
  requestId: string
  chunk: string | number[]
  done: boolean
  error?: string | null
}

const NATIVE_HTTP_CHUNK_EVENT = 'native_http_chunk'

type TauriApis = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>
  listen: (event: string, handler: (event: TauriListenEvent) => void) => Promise<() => void>
}

const activeChunkReceivers = new Map<string, (payload: NativeHttpChunkEvent) => void>()
let sharedListenFn: TauriApis['listen'] | null = null
let sharedUnlisten: (() => void) | null = null
let sharedListenPromise: Promise<void> | null = null

function resetSharedListener() {
  if (sharedUnlisten) {
    const unlisten = sharedUnlisten
    sharedUnlisten = null
    unlisten()
  }
  sharedListenPromise = null
  sharedListenFn = null
}

async function registerChunkReceiver(
  apis: TauriApis,
  requestId: string,
  receiver: (payload: NativeHttpChunkEvent) => void
): Promise<() => void> {
  if (sharedListenFn && sharedListenFn !== apis.listen) {
    resetSharedListener()
    activeChunkReceivers.clear()
  }

  activeChunkReceivers.set(requestId, receiver)

  try {
    if (!sharedUnlisten) {
      if (!sharedListenPromise) {
        const targetListen = apis.listen
        sharedListenFn = targetListen
        sharedListenPromise = targetListen(NATIVE_HTTP_CHUNK_EVENT, (event) => {
          const payload = event.payload
          const handler = payload?.requestId ? activeChunkReceivers.get(payload.requestId) : undefined
          handler?.(payload)
        })
          .then((unlisten) => {
            if (activeChunkReceivers.size === 0 || sharedListenFn !== targetListen) {
              unlisten()
              return
            }
            sharedUnlisten = unlisten
          })
          .finally(() => {
            sharedListenPromise = null
          })
      }
      await sharedListenPromise
    }
  } catch (error) {
    activeChunkReceivers.delete(requestId)
    if (activeChunkReceivers.size === 0) {
      resetSharedListener()
    }
    throw error
  }

  let removed = false
  return () => {
    if (removed) return
    removed = true
    activeChunkReceivers.delete(requestId)
    if (activeChunkReceivers.size === 0) {
      resetSharedListener()
    }
  }
}

function decodeChunkBytes(chunk: string | number[] | undefined): Uint8Array | null {
  if (!chunk || chunk.length === 0) {
    return null
  }
  if (typeof chunk === 'string') {
    const binary = atob(chunk)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return Uint8Array.from(chunk)
}

function getTauriApis(): TauriApis | null {
  const tauri = (window as any).__TAURI__
  const invoke = tauri?.core?.invoke
  const listen = tauri?.event?.listen

  if (typeof invoke !== 'function' || typeof listen !== 'function') {
    return null
  }

  return {
    invoke: invoke as TauriApis['invoke'],
    listen: listen as TauriApis['listen']
  }
}

export function getTauriNativeFetch(): FetchFunction | undefined {
  return getTauriApis() ? tauriNativeFetch : undefined
}

async function tauriNativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const apis = getTauriApis()
  if (!apis) {
    return fetch(input, init)
  }

  const request = new Request(input, init)
  const url = request.url

  if (!/^https?:\/\//i.test(url)) {
    return fetch(request)
  }

  if (request.signal.aborted) {
    throw new DOMException('Request was aborted', 'AbortError')
  }

  const requestId = globalThis.crypto?.randomUUID?.() ?? `native-http-${Date.now()}-${Math.random()}`

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let streamClosed = false
  let pendingChunks: Uint8Array[] = []
  let pendingError: Error | DOMException | null = null
  let pendingDone = false
  let unregisterReceiver: (() => void) | null = null
  let aborting = false
  let consumedSequence = 0
  let replaying = false
  const orderedChunks = new Map<number, NativeHttpChunkEvent>()

  const flushPending = () => {
    if (!controllerRef || streamClosed) {
      return
    }

    for (const chunk of pendingChunks) {
      controllerRef.enqueue(chunk)
    }
    pendingChunks = []

    if (pendingError) {
      streamClosed = true
      controllerRef.error(pendingError)
      pendingError = null
    } else if (pendingDone) {
      streamClosed = true
      controllerRef.close()
    }
  }

  const cleanup = () => {
    if (unregisterReceiver) {
      unregisterReceiver()
      unregisterReceiver = null
    }
    request.signal.removeEventListener('abort', onAbort)
    document.removeEventListener('visibilitychange', resumeDelivery)
  }

  const onAbort = () => {
    if (aborting) {
      return
    }
    aborting = true
    const abortError = new DOMException('Request was aborted', 'AbortError')

    if (controllerRef && !streamClosed) {
      streamClosed = true
      controllerRef.error(abortError)
    } else {
      pendingError = abortError
    }

    cleanup()
    void apis.invoke('abort_http_request', { requestId }).catch((error) => {
      logger.warn('Failed to abort native HTTP request', error as Error)
    })
  }

  request.signal.addEventListener('abort', onAbort, { once: true })

  const consume = (payload: NativeHttpChunkEvent) => {
    if (streamClosed || aborting) return
    const decoded = decodeChunkBytes(payload.chunk)
    if (decoded && decoded.byteLength > 0) pendingChunks.push(decoded)
    if (payload.error) pendingError = new Error(payload.error)
    if (payload.done) {
      pendingDone = true
      cleanup()
    }
    flushPending()
  }

  const receive = (payload: NativeHttpChunkEvent) => {
    if (payload.requestId !== requestId || aborting || streamClosed) return
    if (!payload.sequence) {
      consume(payload)
      return
    }
    if (payload.sequence <= consumedSequence) return
    orderedChunks.set(payload.sequence, payload)
    while (orderedChunks.has(consumedSequence + 1)) {
      const next = orderedChunks.get(++consumedSequence)!
      orderedChunks.delete(consumedSequence)
      consume(next)
    }
    void apis.invoke('acknowledge_http_chunks', { requestId, sequence: consumedSequence }).catch(() => {})
    if (orderedChunks.size) void replay().catch(() => {})
  }

  const replay = async () => {
    if (replaying || aborting || streamClosed) return
    replaying = true
    try {
      for (const event of await apis.invoke('replay_http_chunks', { requestId })) receive(event)
    } finally {
      replaying = false
    }
  }

  const resumeDelivery = () => {
    if (!document.hidden) void replay().catch(() => {})
  }

  document.addEventListener('visibilitychange', resumeDelivery)
  let bodyBuffer: Uint8Array | undefined
  try {
    unregisterReceiver = await registerChunkReceiver(apis, requestId, receive)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!(input instanceof Request) && typeof init?.body === 'string') {
        bodyBuffer = textEncoder.encode(init.body)
      } else {
        bodyBuffer = new Uint8Array(await request.arrayBuffer())
      }
    }
  } catch (error) {
    cleanup()
    throw error
  }

  if (request.signal.aborted) {
    cleanup()
    throw new DOMException('Request was aborted', 'AbortError')
  }

  const nativeRequest: NativeHttpRequest = {
    requestId,
    taskEpoch: backgroundTasks.getEpoch(),
    url,
    method: request.method,
    // Chromium's Request guard drops User-Agent (and some other headers).
    // This request is sent by Rust, so preserve the caller's explicit headers.
    headers: Array.from(
      (() => {
        const headers = new Headers(request.headers)
        if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value))
        return headers
      })().entries()
    ).map(([name, value]) => ({ name, value })),
    body: bodyBuffer && bodyBuffer.length > 0 ? Array.from(bodyBuffer) : undefined
  }

  let responseStart: NativeHttpResponseStart

  try {
    responseStart = await apis.invoke('start_http_request', { request: nativeRequest })
  } catch (error) {
    cleanup()

    if (request.signal.aborted) {
      throw new DOMException('Request was aborted', 'AbortError')
    }

    throw error
  }

  const responseHeaders = new Headers()
  for (const header of responseStart.headers || []) {
    responseHeaders.append(header.name, header.value)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      flushPending()
    },
    cancel() {
      onAbort()
    }
  })

  return new Response(stream, {
    status: responseStart.status,
    statusText: responseStart.statusText || '',
    headers: responseHeaders
  })
}
