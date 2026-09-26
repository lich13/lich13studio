export type StreamAbortHandler = (reason: unknown) => void

export interface StreamAbortController {
  abortController: AbortController
  registerAbortHandler: (handler: StreamAbortHandler) => void
  dispose: () => void
}

export const createStreamAbortController = (): StreamAbortController => {
  const abortController = new AbortController()
  const signal = abortController.signal

  let abortHandler: StreamAbortHandler | undefined

  const handleAbort = () => {
    if (!abortHandler) {
      return
    }

    abortHandler(signal.reason)
  }

  signal.addEventListener('abort', handleAbort, { once: true })

  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', handleAbort)
  }

  const registerAbortHandler = (handler: StreamAbortHandler) => {
    abortHandler = handler

    if (signal.aborted) {
      abortHandler(signal.reason)
    }
  }

  return {
    abortController,
    registerAbortHandler,
    dispose
  }
}
