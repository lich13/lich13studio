import { useCallback, useEffect, useRef } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  streamDone: boolean
  minDelay?: number
  initialText?: string
}

const languages = ['en-US', 'de-DE', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ru-RU', 'el-GR', 'fr-FR', 'pt-PT', 'ro-RO']
const segmenter = new Intl.Segmenter(languages)

export const useSmoothStream = ({ onUpdate, streamDone, minDelay = 10, initialText = '' }: UseSmoothStreamOptions) => {
  const segmentsRef = useRef<string[]>([])
  const readIndexRef = useRef<number>(0)
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastUpdateTimeRef = useRef<number>(0)

  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const minDelayRef = useRef(minDelay)
  minDelayRef.current = minDelay

  const streamDoneRef = useRef(streamDone)
  streamDoneRef.current = streamDone

  const prevStreamDoneRef = useRef(streamDone)

  const cancelLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const flushRemaining = useCallback((forceEmit = false) => {
    const segments = segmentsRef.current
    const remaining = segments.length - readIndexRef.current
    if (remaining > 0) {
      let delta = ''
      for (let i = readIndexRef.current; i < segments.length; i++) {
        delta += segments[i]
      }
      segments.length = 0
      readIndexRef.current = 0
      displayedTextRef.current += delta
      onUpdateRef.current(displayedTextRef.current)
      return
    }

    segments.length = 0
    readIndexRef.current = 0
    if (forceEmit) {
      onUpdateRef.current(displayedTextRef.current)
    }
  }, [])

  const renderLoop = useCallback((currentTime: number) => {
    animationFrameRef.current = null
    const segments = segmentsRef.current
    const remaining = segments.length - readIndexRef.current

    if (remaining <= 0) {
      segments.length = 0
      readIndexRef.current = 0
      return
    }

    if (!streamDoneRef.current && currentTime - lastUpdateTimeRef.current < minDelayRef.current) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
      return
    }
    lastUpdateTimeRef.current = currentTime

    const charsToRenderCount = streamDoneRef.current ? remaining : Math.max(1, Math.floor(remaining / 5))
    const endIndex = readIndexRef.current + charsToRenderCount
    let delta = ''
    for (let i = readIndexRef.current; i < endIndex; i++) {
      delta += segments[i]
    }
    readIndexRef.current = endIndex

    if (readIndexRef.current >= segments.length) {
      segments.length = 0
      readIndexRef.current = 0
    } else if (readIndexRef.current > 1024 && readIndexRef.current * 2 >= segments.length) {
      segmentsRef.current = segments.slice(readIndexRef.current)
      readIndexRef.current = 0
    }

    displayedTextRef.current += delta
    onUpdateRef.current(displayedTextRef.current)

    if (segmentsRef.current.length - readIndexRef.current > 0) {
      animationFrameRef.current = requestAnimationFrame(renderLoop)
    }
  }, [])

  const addChunk = useCallback(
    (chunk: string) => {
      if (!chunk) {
        return
      }
      for (const item of segmenter.segment(chunk)) {
        segmentsRef.current.push(item.segment)
      }
      if (streamDoneRef.current) {
        cancelLoop()
        flushRemaining(false)
        return
      }
      if (animationFrameRef.current === null && segmentsRef.current.length > readIndexRef.current) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
      }
    },
    [cancelLoop, flushRemaining, renderLoop]
  )

  const reset = useCallback(
    (newText = '') => {
      cancelLoop()
      segmentsRef.current.length = 0
      readIndexRef.current = 0
      lastUpdateTimeRef.current = 0
      displayedTextRef.current = newText
      onUpdateRef.current(newText)
    },
    [cancelLoop]
  )

  useEffect(() => {
    const transitionedToDone = !prevStreamDoneRef.current && streamDone
    prevStreamDoneRef.current = streamDone

    if (streamDone) {
      cancelLoop()
      flushRemaining(transitionedToDone)
    }
  }, [streamDone, cancelLoop, flushRemaining])

  useEffect(() => {
    return () => {
      cancelLoop()
    }
  }, [cancelLoop])

  return { addChunk, reset }
}
