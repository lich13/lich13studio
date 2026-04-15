import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'

const logger = loggerService.withContext('TauriNativeFetch')

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
  timeoutMs?: number
}

type NativeHttpResponseStart = {
  requestId: string
  status: number
  statusText: string
  headers: NativeHttpHeader[]
}

type NativeHttpChunkEvent = {
  requestId: string
  chunk: number[]
  done: boolean
  error?: string | null
}

const NATIVE_HTTP_CHUNK_EVENT = 'native_http_chunk'

function getTauriApis() {
  const tauri = (window as any).__TAURI__
  const invoke = tauri?.core?.invoke
  const listen = tauri?.event?.listen

  if (typeof invoke !== 'function' || typeof listen !== 'function') {
    return null
  }

  return {
    invoke: invoke as (cmd: string, args?: Record<string, unknown>) => Promise<any>,
    listen: listen as (event: string, handler: (event: TauriListenEvent) => void) => Promise<() => void>
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
  let unlisten: (() => void) | null = null
  let aborting = false

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
    if (unlisten) {
      unlisten()
      unlisten = null
    }
    request.signal.removeEventListener('abort', onAbort)
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

  unlisten = await apis.listen(NATIVE_HTTP_CHUNK_EVENT, (event) => {
    const payload = event.payload
    if (!payload || payload.requestId !== requestId) {
      return
    }

    if (payload.chunk && payload.chunk.length > 0) {
      pendingChunks.push(Uint8Array.from(payload.chunk))
    }

    if (payload.error) {
      pendingError = new Error(payload.error)
    }

    if (payload.done) {
      pendingDone = true
      cleanup()
    }

    flushPending()
  })

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer())

  const nativeRequest: NativeHttpRequest = {
    requestId,
    url,
    method: request.method,
    headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
    body: bodyBuffer && bodyBuffer.length > 0 ? Array.from(bodyBuffer) : undefined,
    timeoutMs: 600_000
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
