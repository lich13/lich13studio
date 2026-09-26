export const createSSEReadableStream = <T extends Record<string, unknown>>(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onParseError?: (error: unknown, payloadLength: number) => void
): ReadableStream<T> => {
  return new ReadableStream<T>({
    start(controller) {
      const reader = source.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const cancelReader = (reason?: unknown) => reader.cancel(reason).catch(() => {})
      const abortHandler = () => {
        void cancelReader(signal.reason ?? 'aborted')
        controller.error(new DOMException('Aborted', 'AbortError'))
      }

      if (signal.aborted) {
        abortHandler()
        return
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      const emitEvent = (eventString: string): boolean => {
        const dataPayload = eventString
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('')
        if (!dataPayload) return false

        if (dataPayload === '[DONE]') {
          signal.removeEventListener('abort', abortHandler)
          void cancelReader()
          controller.close()
          return true
        }

        try {
          controller.enqueue(JSON.parse(dataPayload) as T)
        } catch (error) {
          onParseError?.(error, dataPayload.length)
        }
        return false
      }

      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            let separatorIndex = buffer.indexOf('\n\n')
            while (separatorIndex !== -1) {
              const rawEvent = buffer.slice(0, separatorIndex).trim()
              buffer = buffer.slice(separatorIndex + 2)
              if (rawEvent && emitEvent(rawEvent)) return
              separatorIndex = buffer.indexOf('\n\n')
            }
          }

          buffer += decoder.decode().replace(/\r\n/g, '\n')
          if (buffer.trim()) emitEvent(buffer.trim())
          signal.removeEventListener('abort', abortHandler)
          controller.close()
        } catch (error) {
          signal.removeEventListener('abort', abortHandler)
          controller.error(error)
        }
      }

      void pump()
    },
    cancel(reason) {
      return source.cancel(reason).catch(() => {})
    }
  })
}
