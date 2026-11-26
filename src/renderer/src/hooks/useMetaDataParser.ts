import { useCallback, useEffect, useRef, useState } from 'react'

export function useMetaDataParser<T extends string>(
  link: string,
  properties: readonly T[],
  options?: {
    timeout?: number
  }
) {
  const { timeout = 5000 } = options || {}

  const [metadata, setMetadata] = useState<Record<T, string>>({} as Record<T, string>)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const parseMetadata = useCallback(async () => {
    if (!link || !isLoading) return

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)])
      const response = await fetch(link, { signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      const htmlContent = await response.text()
      const parsedMetadata = {} as Record<T, string>

      const doc = new DOMParser().parseFromString(htmlContent, 'text/html')
      for (const meta of Array.from(doc.querySelectorAll('meta'))) {
        const metaKey = meta.getAttribute('name') || meta.getAttribute('property')
        const content = meta.getAttribute('content')
        if (!metaKey || content === null || !properties.includes(metaKey as T)) continue
        parsedMetadata[metaKey as T] = content
      }

      setMetadata(parsedMetadata)
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return
      }
      setError(err instanceof Error ? err : new Error('Failed to fetch HTML'))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, link, properties, timeout])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return {
    metadata,
    isLoading,
    error,
    parseMetadata
  }
}
