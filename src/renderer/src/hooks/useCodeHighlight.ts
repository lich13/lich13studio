import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThemedToken } from 'shiki/core'

interface UseCodeHighlightOptions {
  rawLines: string[]
  language: string
  callerId: string
}

interface UseCodeHighlightReturn {
  tokenLines: ThemedToken[][]
  highlightLines: (count?: number, releaseCacheAfter?: boolean) => Promise<void>
  resetHighlight: () => void
  releaseStreamCache: () => void
}

/**
 * 用于 shiki 流式代码高亮
 */
export const useCodeHighlight = ({ rawLines, language, callerId }: UseCodeHighlightOptions): UseCodeHighlightReturn => {
  const { activeShikiTheme, highlightStreamingCode, cleanupTokenizers } = useCodeStyle()
  const [tokenLines, setTokenLines] = useState<ThemedToken[][]>([])
  const processingRef = useRef(false)
  const latestRequestedContentRef = useRef<string | null>(null)
  const lastHighlightedContentRef = useRef<string | null>(null)
  const pendingReleaseRef = useRef(false)
  const tokenLinesCountRef = useRef(0)
  const resetEpochRef = useRef(0)
  const shikiThemeRef = useRef(activeShikiTheme)

  const rawLinesRef = useRef(rawLines)
  rawLinesRef.current = rawLines
  const languageRef = useRef(language)
  languageRef.current = language
  const callerIdRef = useRef(callerId)
  callerIdRef.current = callerId
  const highlightStreamingCodeRef = useRef(highlightStreamingCode)
  highlightStreamingCodeRef.current = highlightStreamingCode
  const cleanupTokenizersRef = useRef(cleanupTokenizers)
  cleanupTokenizersRef.current = cleanupTokenizers

  useEffect(() => {
    tokenLinesCountRef.current = tokenLines.length
  }, [tokenLines])

  const releaseStreamCache = useCallback(() => {
    if (processingRef.current) {
      pendingReleaseRef.current = true
      return
    }
    cleanupTokenizersRef.current(callerIdRef.current)
  }, [])

  const highlightLines = useCallback(async (count?: number, releaseCacheAfter = false) => {
    const lines = rawLinesRef.current
    const targetCount = count === undefined ? lines.length : Math.min(count, lines.length)

    if (releaseCacheAfter && targetCount >= lines.length) {
      pendingReleaseRef.current = true
    }

    const fullContent = lines.join('\n').trimEnd()
    const prevHighlighted = lastHighlightedContentRef.current
    const isPrefixContinuation = prevHighlighted === null || fullContent.startsWith(prevHighlighted)

    if (!processingRef.current && isPrefixContinuation && targetCount < tokenLinesCountRef.current) {
      if (pendingReleaseRef.current) {
        pendingReleaseRef.current = false
        cleanupTokenizersRef.current(callerIdRef.current)
      }
      return
    }

    const currentContent = lines.slice(0, targetCount).join('\n').trimEnd()
    if (!processingRef.current && prevHighlighted !== null && currentContent === prevHighlighted) {
      if (pendingReleaseRef.current) {
        pendingReleaseRef.current = false
        cleanupTokenizersRef.current(callerIdRef.current)
      }
      return
    }

    pendingReleaseRef.current = releaseCacheAfter && targetCount >= lines.length
    latestRequestedContentRef.current = currentContent

    if (processingRef.current) return

    processingRef.current = true

    try {
      while (latestRequestedContentRef.current !== null) {
        const contentToProcess = latestRequestedContentRef.current
        latestRequestedContentRef.current = null

        if (lastHighlightedContentRef.current !== null && contentToProcess === lastHighlightedContentRef.current) {
          continue
        }

        if (contentToProcess.length === 0) {
          cleanupTokenizersRef.current(callerIdRef.current)
          lastHighlightedContentRef.current = ''
          tokenLinesCountRef.current = 0
          setTokenLines([])
          continue
        }

        const requestEpoch = resetEpochRef.current
        let result: Awaited<ReturnType<typeof highlightStreamingCode>>
        try {
          result = await highlightStreamingCodeRef.current(contentToProcess, languageRef.current, callerIdRef.current)
        } catch (error) {
          if (latestRequestedContentRef.current !== null) {
            lastHighlightedContentRef.current = null
            continue
          }
          throw error
        }
        if (requestEpoch !== resetEpochRef.current) {
          cleanupTokenizersRef.current(callerIdRef.current)
          continue
        }
        const nextQueued = latestRequestedContentRef.current as string | null
        if (nextQueued !== null && !nextQueued.startsWith(contentToProcess)) {
          lastHighlightedContentRef.current = null
          continue
        }
        lastHighlightedContentRef.current = contentToProcess

        if (result.lines.length > 0 || result.recall !== 0) {
          setTokenLines((prev) => {
            const next =
              result.recall === -1
                ? result.lines
                : [...prev.slice(0, Math.max(0, prev.length - result.recall)), ...result.lines]
            tokenLinesCountRef.current = next.length
            return next
          })
        }
      }
    } finally {
      processingRef.current = false
      if (pendingReleaseRef.current) {
        pendingReleaseRef.current = false
        cleanupTokenizersRef.current(callerIdRef.current)
      }
    }
  }, [])

  const resetHighlight = useCallback(() => {
    resetEpochRef.current += 1
    pendingReleaseRef.current = false
    latestRequestedContentRef.current = null
    lastHighlightedContentRef.current = null
    cleanupTokenizersRef.current(callerIdRef.current)
    tokenLinesCountRef.current = 0
    setTokenLines([])
  }, [])

  // 主题或语言变化时强制重新高亮
  const prevLangRef = useRef(language)
  useEffect(() => {
    if (shikiThemeRef.current !== activeShikiTheme || prevLangRef.current !== language) {
      shikiThemeRef.current = activeShikiTheme
      prevLangRef.current = language
      resetHighlight()
    }
  }, [activeShikiTheme, language, resetHighlight])

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      cleanupTokenizersRef.current(callerIdRef.current)
    }
  }, [])

  return {
    tokenLines,
    highlightLines,
    resetHighlight,
    releaseStreamCache
  }
}
