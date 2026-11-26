import 'remark-github-blockquote-alert/alert.css'

import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { useSettings } from '@renderer/hooks/useSettings'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type {
  CompactMessageBlock,
  MainTextMessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import isEmpty from 'lodash/isEmpty'
import { type FC, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkAlert from 'remark-github-blockquote-alert'
import remarkMath from 'remark-math'
import type { Pluggable } from 'unified'

import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import rehypeHeadingIds, { normalizeHeadingSlug } from './plugins/rehypeHeadingIds'
import rehypeScalableSvg from './plugins/rehypeScalableSvg'
import remarkCjkAutolinkLiteral from './plugins/remarkCjkAutolinkLiteral'
import remarkDisableConstructs from './plugins/remarkDisableConstructs'
import Table from './Table'

const LazyImageViewer = lazy(() => import('@renderer/components/ImageViewer'))

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup|details|summary)/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']
const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HAS_MATH_SYNTAX_REGEX = /\$|\\\[|\\\(|(?:^|\n)\s*(?:`{3,}|~{3,})\s*math\b/i
const STREAM_SEGMENT_MIN_CHARS = 1600
const STREAM_TAIL_KEEP_CHARS = 400
const STREAM_PREFIX_STEP_CHARS = 1024
const UNSAFE_PREFIX_SPLIT_DOC_REGEX = /\[\^|\]:\s|\]\[|<\/?(?:details|summary|table|div|style)\b/i
const LIST_OR_QUOTE_MARKER_REGEX = /^(?:>|\d+[.)]\s|[-*+]\s)/
const UNSAFE_NEXT_LINE_HEAD_REGEX = /^(?:\||>|\d+[.)]\s|[-*+]\s)/
const UNSAFE_NEXT_LINE_REGEX = /^(?:\||>|\d+[.)]\s|[-*+]\s|={2,}\s*$|-{2,}\s*$)/
interface InlineSplitState {
  bracketMathDepth: number
  parenMathDepth: number
  svgDepth: number
  svgTagMode: 'none' | 'open' | 'close'
  svgTagQuote: '' | '"' | "'"
  svgTagTrailingSlash: boolean
  inSvgInnerTag: boolean
  svgInnerTagQuote: '' | '"' | "'"
  inXmlComment: boolean
  inCdata: boolean
  inlineCodeTickLen: number
}

function findXmlCommentEnd(line: string, fromIndex: number): number {
  const stdIdx = line.indexOf('-->', fromIndex)
  const bangIdx = line.indexOf('--!>', fromIndex)
  if (stdIdx === -1 && bangIdx === -1) {
    return -1
  }
  if (stdIdx !== -1 && (bangIdx === -1 || stdIdx < bangIdx)) {
    return stdIdx + 2
  }
  return bangIdx + 3
}

function scanInlineRange(line: string, state: InlineSplitState, stopBeforeAmbiguousTail: boolean): number {
  for (let i = 0; i < line.length; i += 1) {
    if (state.inXmlComment) {
      const closeEndIdx = findXmlCommentEnd(line, i)
      if (closeEndIdx === -1) {
        return stopBeforeAmbiguousTail ? Math.max(i, line.length - 3) : line.length
      }
      state.inXmlComment = false
      i = closeEndIdx
      continue
    }

    if (state.inCdata) {
      const closeIdx = line.indexOf(']]>', i)
      if (closeIdx === -1) {
        return stopBeforeAmbiguousTail ? Math.max(i, line.length - 2) : line.length
      }
      state.inCdata = false
      i = closeIdx + 2
      continue
    }

    const code = line.charCodeAt(i)

    if (state.svgTagMode !== 'none') {
      if (state.svgTagQuote !== '') {
        if ((state.svgTagQuote === '"' && code === 34) || (state.svgTagQuote === "'" && code === 39)) {
          state.svgTagQuote = ''
        }
        continue
      }
      if (code === 34 /* " */) {
        state.svgTagQuote = '"'
        state.svgTagTrailingSlash = false
        continue
      }
      if (code === 39 /* ' */) {
        state.svgTagQuote = "'"
        state.svgTagTrailingSlash = false
        continue
      }
      if (code === 62 /* > */) {
        if (state.svgTagMode === 'open') {
          if (!state.svgTagTrailingSlash) {
            state.svgDepth += 1
          }
        } else if (state.svgDepth > 0) {
          state.svgDepth -= 1
          if (state.svgDepth === 0) {
            state.inSvgInnerTag = false
            state.svgInnerTagQuote = ''
          }
        }
        state.svgTagMode = 'none'
        state.svgTagTrailingSlash = false
        continue
      }
      state.svgTagTrailingSlash = code === 47 /* / */
      continue
    }

    if (state.inSvgInnerTag) {
      if (state.svgInnerTagQuote !== '') {
        if ((state.svgInnerTagQuote === '"' && code === 34) || (state.svgInnerTagQuote === "'" && code === 39)) {
          state.svgInnerTagQuote = ''
        }
        continue
      }
      if (code === 34 /* " */) {
        state.svgInnerTagQuote = '"'
        continue
      }
      if (code === 39 /* ' */) {
        state.svgInnerTagQuote = "'"
        continue
      }
      if (code === 62 /* > */) {
        state.inSvgInnerTag = false
      }
      continue
    }

    if (state.inlineCodeTickLen !== 0) {
      if (code === 96 /* ` */) {
        let ticks = 1
        while (i + ticks < line.length && line.charCodeAt(i + ticks) === 96) {
          ticks += 1
        }
        if (stopBeforeAmbiguousTail && i + ticks >= line.length) {
          return i
        }
        if (state.inlineCodeTickLen === ticks) {
          state.inlineCodeTickLen = 0
        }
        i += ticks - 1
      }
      continue
    }

    if (code === 96 /* ` */ && state.svgDepth === 0) {
      let ticks = 1
      while (i + ticks < line.length && line.charCodeAt(i + ticks) === 96) {
        ticks += 1
      }
      if (stopBeforeAmbiguousTail && i + ticks >= line.length) {
        return i
      }
      state.inlineCodeTickLen = ticks
      i += ticks - 1
      continue
    }

    if (code === 60 /* < */) {
      if (stopBeforeAmbiguousTail && i + 9 > line.length) {
        return i
      }
      if (line.startsWith('<!--', i)) {
        if (line.startsWith('<!-->', i)) {
          i += 4
        } else if (line.startsWith('<!--->', i)) {
          i += 5
        } else {
          state.inXmlComment = true
          i += 3
        }
        continue
      }
      if (line.charCodeAt(i + 1) === 33 /* ! */ && line.slice(i, i + 9).toUpperCase() === '<![CDATA[') {
        state.inCdata = true
        i += 8
        continue
      }
      if (
        i + 4 <= line.length &&
        line.slice(i + 1, i + 4).toLowerCase() === 'svg' &&
        (i + 4 === line.length || /[\s/>]/.test(line[i + 4]))
      ) {
        state.svgTagMode = 'open'
        state.svgTagQuote = ''
        state.svgTagTrailingSlash = false
        i += 3
        continue
      }
      if (
        line.charCodeAt(i + 1) === 47 /* / */ &&
        i + 5 <= line.length &&
        line.slice(i + 2, i + 5).toLowerCase() === 'svg' &&
        (i + 5 === line.length || /[\s>]/.test(line[i + 5]))
      ) {
        state.svgTagMode = 'close'
        state.svgTagQuote = ''
        state.svgTagTrailingSlash = false
        i += 4
        continue
      }
      if (state.svgDepth > 0 && i + 1 < line.length && /[A-Za-z/?!]/.test(line[i + 1])) {
        state.inSvgInnerTag = true
        state.svgInnerTagQuote = ''
        continue
      }
    }

    if (state.svgDepth !== 0 || code !== 92 /* \ */) {
      continue
    }
    let backslashes = 1
    while (i + backslashes < line.length && line.charCodeAt(i + backslashes) === 92) {
      backslashes += 1
    }
    const nextCharPos = i + backslashes
    if (stopBeforeAmbiguousTail && nextCharPos >= line.length) {
      return i
    }
    if (nextCharPos >= line.length) {
      break
    }
    if ((backslashes & 1) === 1) {
      const delimCode = line.charCodeAt(nextCharPos)
      if (delimCode === 91 /* [ */) {
        state.bracketMathDepth += 1
        i = nextCharPos
        continue
      }
      if (delimCode === 93 /* ] */) {
        if (state.bracketMathDepth > 0) {
          state.bracketMathDepth -= 1
        }
        i = nextCharPos
        continue
      }
      if (delimCode === 40 /* ( */) {
        state.parenMathDepth += 1
        i = nextCharPos
        continue
      }
      if (delimCode === 41 /* ) */) {
        if (state.parenMathDepth > 0) {
          state.parenMathDepth -= 1
        }
        i = nextCharPos
        continue
      }
    }
    i = nextCharPos - 1
  }
  return line.length
}

function updateLineMathAndSvgState(line: string, state: InlineSplitState): void {
  scanInlineRange(line, state, false)
}

function createInitialInlineState(): InlineSplitState {
  return {
    bracketMathDepth: 0,
    parenMathDepth: 0,
    svgDepth: 0,
    svgTagMode: 'none',
    svgTagQuote: '',
    svgTagTrailingSlash: false,
    inSvgInnerTag: false,
    svgInnerTagQuote: '',
    inXmlComment: false,
    inCdata: false,
    inlineCodeTickLen: 0
  }
}

export interface StreamingMarkdownScanner {
  scan(content: string): { prefix: string; tail: string }
  reset(): void
}

export function createStreamingMarkdownScanner(): StreamingMarkdownScanner {
  let verifiedText = ''
  let cleanUpTo = 0
  let permanentlyUnsafe = false
  let unsafePrefix = ''
  let checkpointLineStart = 0
  let checkpointFenceChar = ''
  let checkpointFenceLen = 0
  let checkpointInDisplayMath = false
  let checkpointInListOrQuote = false
  let checkpointInlineState: InlineSplitState = createInitialInlineState()
  let midLineLineStart = -1
  let midLineFirstNonWs = 0
  let midLineCursor = 0
  let midLineInlineState: InlineSplitState = createInitialInlineState()
  let midLineHasTwoLeadingIndents = false
  let midLineSetextChar: '' | '=' | '-' = ''
  let midLineSetextRunLen = 0
  let midLineSetextTrailingWs = false
  let midLineSetextScanPos = 0
  let safeSplits: number[] = []

  const clearMidLine = () => {
    midLineLineStart = -1
    midLineFirstNonWs = 0
    midLineCursor = 0
    midLineInlineState = createInitialInlineState()
    midLineHasTwoLeadingIndents = false
    midLineSetextChar = ''
    midLineSetextRunLen = 0
    midLineSetextTrailingWs = false
    midLineSetextScanPos = 0
  }

  const advanceMidLineSetext = (content: string, lineEnd: number) => {
    while (midLineSetextChar !== '' && midLineSetextScanPos < lineEnd) {
      const ch = content[midLineSetextScanPos]
      if (!midLineSetextTrailingWs && ch === midLineSetextChar) {
        midLineSetextRunLen += 1
      } else if (/\s/.test(ch)) {
        midLineSetextTrailingWs = true
      } else {
        midLineSetextChar = ''
        break
      }
      midLineSetextScanPos += 1
    }
  }

  const reset = () => {
    verifiedText = ''
    cleanUpTo = 0
    permanentlyUnsafe = false
    unsafePrefix = ''
    checkpointLineStart = 0
    checkpointFenceChar = ''
    checkpointFenceLen = 0
    checkpointInDisplayMath = false
    checkpointInListOrQuote = false
    checkpointInlineState = createInitialInlineState()
    clearMidLine()
    safeSplits = []
  }

  const scan = (content: string): { prefix: string; tail: string } => {
    if (permanentlyUnsafe) {
      if (unsafePrefix.length > 0 && content.startsWith(unsafePrefix)) {
        return { prefix: '', tail: content }
      }
      reset()
    } else if (verifiedText.length > 0 && !content.startsWith(verifiedText)) {
      reset()
    }

    if (content.length < STREAM_SEGMENT_MIN_CHARS) {
      return { prefix: '', tail: content }
    }

    const unsafeMatch = UNSAFE_PREFIX_SPLIT_DOC_REGEX.exec(content.slice(cleanUpTo))
    if (unsafeMatch) {
      const absMatchEnd = cleanUpTo + unsafeMatch.index + unsafeMatch[0].length
      if (absMatchEnd < content.length) {
        permanentlyUnsafe = true
        unsafePrefix = content.slice(0, absMatchEnd + 1)
      }
      return { prefix: '', tail: content }
    }

    const targetMaxSplit = content.length - STREAM_TAIL_KEEP_CHARS
    let activeFenceChar = checkpointFenceChar
    let activeFenceLen = checkpointFenceLen
    let inDisplayMath = checkpointInDisplayMath
    let inListOrQuote = checkpointInListOrQuote
    const inlineState: InlineSplitState = { ...checkpointInlineState }
    let lineStart = checkpointLineStart
    let trailingSafeSplit = 0
    let lastVerifiedEnd = verifiedText.length

    while (lineStart < content.length) {
      const newlineIdx = content.indexOf('\n', lineStart)
      const lineEnd = newlineIdx === -1 ? content.length : newlineIdx

      if (lineStart === midLineLineStart) {
        advanceMidLineSetext(content, lineEnd)
        const trimmedHead = content.slice(midLineFirstNonWs, Math.min(lineEnd, midLineFirstNonWs + 64))
        if (newlineIdx === -1) {
          const nextMidState: InlineSplitState = { ...midLineInlineState }
          const delta = content.slice(midLineCursor, lineEnd)
          const consumed = scanInlineRange(delta, nextMidState, true)
          midLineCursor += consumed
          midLineInlineState = nextMidState
          lastVerifiedEnd = Math.max(lastVerifiedEnd, midLineCursor)
          Object.assign(inlineState, nextMidState)
          if (midLineCursor < lineEnd) {
            scanInlineRange(content.slice(midLineCursor, lineEnd), inlineState, false)
          }
          if (
            !inlineState.inXmlComment &&
            !inlineState.inCdata &&
            inlineState.bracketMathDepth === 0 &&
            inlineState.parenMathDepth === 0 &&
            inlineState.svgDepth === 0 &&
            inlineState.svgTagMode === 'none'
          ) {
            if (LIST_OR_QUOTE_MARKER_REGEX.test(trimmedHead)) {
              inListOrQuote = true
            } else if (!midLineHasTwoLeadingIndents) {
              inListOrQuote = false
            }
          }
          break
        }

        Object.assign(inlineState, midLineInlineState)
        if (midLineCursor < lineEnd) {
          scanInlineRange(content.slice(midLineCursor, lineEnd), inlineState, false)
        }
        if (
          !inlineState.inXmlComment &&
          !inlineState.inCdata &&
          inlineState.bracketMathDepth === 0 &&
          inlineState.parenMathDepth === 0 &&
          inlineState.svgDepth === 0 &&
          inlineState.svgTagMode === 'none'
        ) {
          if (LIST_OR_QUOTE_MARKER_REGEX.test(trimmedHead)) {
            inListOrQuote = true
          } else if (!midLineHasTwoLeadingIndents) {
            inListOrQuote = false
          }
        }
        clearMidLine()
        checkpointLineStart = newlineIdx + 1
        checkpointFenceChar = activeFenceChar
        checkpointFenceLen = activeFenceLen
        checkpointInDisplayMath = inDisplayMath
        checkpointInListOrQuote = inListOrQuote
        checkpointInlineState = { ...inlineState }
        const nextLineEndAfterMid = content.indexOf('\n', newlineIdx + 1)
        lastVerifiedEnd = Math.max(
          lastVerifiedEnd,
          nextLineEndAfterMid !== -1 ? nextLineEndAfterMid + 1 : newlineIdx + 1
        )
        lineStart = newlineIdx + 1
        continue
      }

      const inlineAllowsFenceOrDisplay =
        !inlineState.inXmlComment &&
        !inlineState.inCdata &&
        inlineState.svgDepth === 0 &&
        inlineState.svgTagMode === 'none' &&
        inlineState.inlineCodeTickLen === 0

      // Fast path for unclosed lines inside an active code fence so 50k-char single lines stay O(delta)
      if (newlineIdx === -1 && activeFenceChar && lineEnd - lineStart > 16) {
        const fenceHead = content.slice(lineStart, lineStart + 16)
        if (!/^ {0,3}[`~]/.test(fenceHead)) {
          lastVerifiedEnd = Math.max(lastVerifiedEnd, lineEnd - 16)
          break
        }
      }

      const line = content.slice(lineStart, lineEnd)
      const trimmed = line.trimStart()

      const fenceMatch = !inDisplayMath && inlineAllowsFenceOrDisplay ? /^ {0,3}(`{3,}|~{3,})/.exec(line) : null
      let handledAsFence = false
      if (fenceMatch) {
        const char = fenceMatch[1][0]
        const len = fenceMatch[1].length
        const afterFence = line.slice(fenceMatch[0].length)
        if (!activeFenceChar) {
          // CommonMark §4.5: backtick code fence info strings cannot contain backticks.
          if (char !== '`' || !afterFence.includes('`')) {
            activeFenceChar = char
            activeFenceLen = len
            handledAsFence = true
          }
        } else if (char === activeFenceChar && len >= activeFenceLen && afterFence.trim() === '') {
          activeFenceChar = ''
          activeFenceLen = 0
          handledAsFence = true
        }
      }

      if (!handledAsFence && !activeFenceChar) {
        if (trimmed === '') {
          // CommonMark inline code spans cannot cross blank lines; reset any unmatched backticks.
          if (
            !inlineState.inXmlComment &&
            !inlineState.inCdata &&
            inlineState.svgDepth === 0 &&
            inlineState.svgTagMode === 'none'
          ) {
            inlineState.inlineCodeTickLen = 0
          }
        } else if (inlineAllowsFenceOrDisplay && trimmed.startsWith('$$')) {
          const wasInDisplayMath = inDisplayMath
          const parts = trimmed.split('$$')
          const occurrences = parts.length - 1
          if (occurrences % 2 === 1) {
            inDisplayMath = !inDisplayMath
          }
          const outsideMath = parts
            .filter((_, idx) => (wasInDisplayMath ? idx % 2 === 1 : idx % 2 === 0))
            .join(' ')
            .trim()
          if (outsideMath) {
            updateLineMathAndSvgState(outsideMath, inlineState)
          }
        } else if (!inDisplayMath) {
          const canInitMidLine =
            newlineIdx === -1 &&
            (!inlineAllowsFenceOrDisplay || (!/^ {0,3}(?:`{1,2}|~{1,2})$/.test(line) && trimmed !== '$'))
          if (canInitMidLine) {
            const nextMidState: InlineSplitState = { ...inlineState }
            const consumed = scanInlineRange(line, nextMidState, true)
            const leadingWsLen = line.length - trimmed.length
            midLineLineStart = lineStart
            midLineFirstNonWs = lineStart + leadingWsLen
            midLineCursor = lineStart + consumed
            midLineInlineState = nextMidState
            midLineHasTwoLeadingIndents = /^[ \t]{2,}/.test(line.slice(0, Math.min(line.length, 4)))
            const firstChar = trimmed[0]
            if (firstChar === '=' || firstChar === '-') {
              midLineSetextChar = firstChar
              midLineSetextRunLen = 1
              midLineSetextTrailingWs = false
              midLineSetextScanPos = midLineFirstNonWs + 1
              advanceMidLineSetext(content, lineEnd)
            } else {
              midLineSetextChar = ''
              midLineSetextRunLen = 0
              midLineSetextTrailingWs = false
              midLineSetextScanPos = lineEnd
            }
            lastVerifiedEnd = Math.max(lastVerifiedEnd, midLineCursor)
            Object.assign(inlineState, nextMidState)
            if (consumed < line.length) {
              scanInlineRange(line.slice(consumed), inlineState, false)
            }
          } else {
            updateLineMathAndSvgState(line, inlineState)
          }
        }

        if (
          !inDisplayMath &&
          !inlineState.inXmlComment &&
          !inlineState.inCdata &&
          inlineState.bracketMathDepth === 0 &&
          inlineState.parenMathDepth === 0 &&
          inlineState.svgDepth === 0 &&
          inlineState.svgTagMode === 'none' &&
          trimmed !== ''
        ) {
          if (LIST_OR_QUOTE_MARKER_REGEX.test(trimmed)) {
            inListOrQuote = true
          } else if (!/^[ \t]{2,}/.test(line)) {
            inListOrQuote = false
          }
        }
      }

      const nextLineEnd = newlineIdx !== -1 ? content.indexOf('\n', newlineIdx + 1) : -1
      let isSafeBlankSplit = false
      if (
        !activeFenceChar &&
        !inDisplayMath &&
        !inlineState.inXmlComment &&
        !inlineState.inCdata &&
        inlineState.bracketMathDepth === 0 &&
        inlineState.parenMathDepth === 0 &&
        inlineState.svgDepth === 0 &&
        inlineState.svgTagMode === 'none' &&
        inlineState.inlineCodeTickLen === 0 &&
        !inListOrQuote &&
        trimmed === '' &&
        newlineIdx !== -1
      ) {
        if (nextLineEnd === -1 && midLineLineStart === newlineIdx + 1) {
          advanceMidLineSetext(content, content.length)
          const nextHead = content.slice(midLineFirstNonWs, Math.min(content.length, midLineFirstNonWs + 64))
          if (nextHead !== '' && !/^\d{64}$/.test(nextHead)) {
            const isSetextUnderline = midLineSetextChar !== '' && midLineSetextRunLen >= 2
            if (!midLineHasTwoLeadingIndents && !isSetextUnderline && !UNSAFE_NEXT_LINE_HEAD_REGEX.test(nextHead)) {
              isSafeBlankSplit = true
            }
          } else {
            const rawNextLine = content.slice(newlineIdx + 1, content.length)
            const nextTrimmed = rawNextLine.trimStart()
            if (nextTrimmed !== '' && !/^[ \t]{2,}/.test(rawNextLine) && !UNSAFE_NEXT_LINE_REGEX.test(nextTrimmed)) {
              isSafeBlankSplit = true
            }
          }
        } else {
          const rawNextLine = content.slice(newlineIdx + 1, nextLineEnd === -1 ? content.length : nextLineEnd)
          const nextTrimmed = rawNextLine.trimStart()
          if (nextTrimmed !== '' && !/^[ \t]{2,}/.test(rawNextLine) && !UNSAFE_NEXT_LINE_REGEX.test(nextTrimmed)) {
            isSafeBlankSplit = true
          }
        }
      }

      if (newlineIdx !== -1 && (nextLineEnd !== -1 || trimmed !== '')) {
        if (isSafeBlankSplit) {
          safeSplits.push(newlineIdx + 1)
        }
        checkpointLineStart = newlineIdx + 1
        checkpointFenceChar = activeFenceChar
        checkpointFenceLen = activeFenceLen
        checkpointInDisplayMath = inDisplayMath
        checkpointInListOrQuote = inListOrQuote
        checkpointInlineState = { ...inlineState }
        if (checkpointLineStart > midLineLineStart) {
          clearMidLine()
        }
        lastVerifiedEnd = Math.max(lastVerifiedEnd, nextLineEnd !== -1 ? nextLineEnd + 1 : newlineIdx + 1)
      } else if (isSafeBlankSplit && newlineIdx + 1 <= targetMaxSplit) {
        trailingSafeSplit = newlineIdx + 1
      }

      if (newlineIdx === -1) break
      lineStart = newlineIdx + 1
    }

    if (lastVerifiedEnd > verifiedText.length) {
      verifiedText = content.slice(0, lastVerifiedEnd)
      cleanUpTo = Math.max(cleanUpTo, Math.min(lastVerifiedEnd, Math.max(0, content.length - 16)))
    }

    let bestFromCheckpoint = 0
    for (let idx = safeSplits.length - 1; idx >= 0; idx -= 1) {
      if (safeSplits[idx] <= targetMaxSplit) {
        bestFromCheckpoint = safeSplits[idx]
        break
      }
    }

    const lastSafeSplit = Math.max(bestFromCheckpoint, trailingSafeSplit)
    if (lastSafeSplit < STREAM_PREFIX_STEP_CHARS) {
      return { prefix: '', tail: content }
    }
    return {
      prefix: content.slice(0, lastSafeSplit),
      tail: content.slice(lastSafeSplit)
    }
  }

  return { scan, reset }
}

export function splitStreamingMarkdownPrefix(content: string): { prefix: string; tail: string } {
  return createStreamingMarkdownScanner().scan(content)
}

const MarkdownSegment = memo(
  ({
    content,
    rehypePlugins,
    remarkPlugins,
    baseComponents,
    hasStyleElement,
    blockId,
    lineOffset = 0,
    charOffset = 0,
    rawLineOffset = lineOffset,
    rawCharOffset = charOffset,
    initialHeadingCounts,
    urlTransform,
    footnoteLabel
  }: {
    content: string
    rehypePlugins: Pluggable[]
    remarkPlugins: Pluggable[]
    baseComponents: Partial<Components>
    hasStyleElement: boolean
    blockId: string
    lineOffset?: number
    charOffset?: number
    rawLineOffset?: number
    rawCharOffset?: number
    initialHeadingCounts?: ReadonlyMap<string, number>
    urlTransform: (value: string) => string
    footnoteLabel: string
  }) => {
    const contentRef = useRef(content)
    contentRef.current = content
    const getSegmentContent = useCallback(() => contentRef.current, [])

    const effectiveRehypePlugins = useMemo(() => {
      if (!initialHeadingCounts || initialHeadingCounts.size === 0) {
        return rehypePlugins
      }
      return rehypePlugins.map((plugin) =>
        Array.isArray(plugin) && plugin[0] === rehypeHeadingIds
          ? ([
              rehypeHeadingIds,
              { ...(plugin[1] as Record<string, unknown>), initialSeen: initialHeadingCounts }
            ] as Pluggable)
          : plugin
      )
    }, [initialHeadingCounts, rehypePlugins])

    const segmentComponents = useMemo(() => {
      const withStyle = hasStyleElement
        ? { ...baseComponents, style: MarkdownShadowDOMRenderer as any }
        : baseComponents
      const tableRenderer = (props: any) => (
        <Table
          {...props}
          blockId={blockId}
          lineOffset={rawLineOffset}
          charOffset={rawCharOffset}
          getSegmentContent={getSegmentContent}
        />
      )
      if (rawCharOffset === 0 && rawLineOffset === 0) {
        return {
          ...withStyle,
          table: tableRenderer
        } as Partial<Components>
      }
      return {
        ...withStyle,
        code: (props: any) => {
          const pos = props?.node?.position
          const shiftedNode = pos
            ? {
                ...props.node,
                position: {
                  start: pos.start
                    ? {
                        ...pos.start,
                        line: pos.start.line + rawLineOffset,
                        offset: pos.start.offset !== undefined ? pos.start.offset + rawCharOffset : undefined
                      }
                    : undefined,
                  end: pos.end
                    ? {
                        ...pos.end,
                        line: pos.end.line + rawLineOffset,
                        offset: pos.end.offset !== undefined ? pos.end.offset + rawCharOffset : undefined
                      }
                    : undefined
                }
              }
            : props.node
          return <CodeBlock {...props} node={shiftedNode} blockId={blockId} />
        },
        table: tableRenderer
      } as Partial<Components>
    }, [baseComponents, blockId, getSegmentContent, hasStyleElement, rawCharOffset, rawLineOffset])

    return (
      <ReactMarkdown
        rehypePlugins={effectiveRehypePlugins}
        remarkPlugins={remarkPlugins}
        components={segmentComponents}
        disallowedElements={DISALLOWED_ELEMENTS}
        urlTransform={urlTransform}
        remarkRehypeOptions={{
          footnoteLabel,
          footnoteLabelTagName: 'h4',
          footnoteBackContent: ' '
        }}>
        {content}
      </ReactMarkdown>
    )
  }
)
MarkdownSegment.displayName = 'MarkdownSegment'

interface Props {
  block: MainTextMessageBlock | TranslationMessageBlock | ThinkingMessageBlock | CompactMessageBlock
  postProcess?: (text: string) => string
}

let cachedKatexPlugin: Pluggable | null = null
let katexLoadPromise: Promise<Pluggable> | null = null

function loadKatexPlugin(): Promise<Pluggable> {
  if (cachedKatexPlugin) {
    return Promise.resolve(cachedKatexPlugin)
  }
  if (!katexLoadPromise) {
    katexLoadPromise = Promise.all([
      import('katex/dist/katex.min.css'),
      import('katex/contrib/copy-tex'),
      import('katex/contrib/mhchem'),
      import('rehype-katex')
    ])
      .then(([, , , mod]) => {
        const resolved = (mod.default ?? mod) as Pluggable
        cachedKatexPlugin = resolved
        return resolved
      })
      .catch((error) => {
        katexLoadPromise = null
        throw error
      })
  }
  return katexLoadPromise
}

interface CommittedMarkdownSegment {
  key: string
  processed: string
  charOffset: number
  lineOffset: number
  rawCharOffset: number
  rawLineOffset: number
  initialHeadingCounts?: ReadonlyMap<string, number>
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1
  }
  return count
}

function advanceHeadingCounts(text: string, prev: ReadonlyMap<string, number>): Map<string, number> {
  const next = new Map(prev)
  let fenceChar = ''
  let fenceLen = 0
  let start = 0
  while (start <= text.length) {
    const nl = text.indexOf('\n', start)
    const line = nl === -1 ? text.slice(start) : text.slice(start, nl)
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const ch = fence[1][0]
      const len = fence[1].length
      if (!fenceChar && (ch !== '`' || !fence[2].includes('`'))) {
        fenceChar = ch
        fenceLen = len
      } else if (fenceChar === ch && len >= fenceLen && fence[2].trim() === '') {
        fenceChar = ''
        fenceLen = 0
      }
    } else if (!fenceChar) {
      const atx = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(line)
      if (atx) {
        const plain = atx[1].replace(/[*_~`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        const base = normalizeHeadingSlug(plain)
        next.set(base, (next.get(base) || 0) + 1)
      } else {
        const htmlH = /<h([1-6])[^>]*>(.*?)<\/h\1>/i.exec(line)
        if (htmlH) {
          const base = normalizeHeadingSlug(htmlH[2].replace(/<[^>]*>/g, ''))
          next.set(base, (next.get(base) || 0) + 1)
        }
      }
    }
    if (nl === -1) break
    start = nl + 1
  }
  return next
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const { mathEngine, mathEnableSingleDollar } = useSettings()
  const [katexPlugin, setKatexPlugin] = useState<Pluggable | null>(() => cachedKatexPlugin)

  const isStreamingBlock = 'status' in block && block.status === 'streaming'
  const isStreamDone = !isStreamingBlock
  const [displayedContent, setDisplayedContent] = useState(postProcess ? postProcess(block.content) : block.content)

  const prevContentRef = useRef(block.content)
  const prevBlockIdRef = useRef(block.id)
  const scannerRef = useRef<StreamingMarkdownScanner | null>(null)
  const contentLength = block.content?.length ?? 0
  const streamMinDelay = !isStreamingBlock ? 10 : contentLength > 8000 ? 48 : contentLength > 3000 ? 32 : 12

  const { addChunk, reset } = useSmoothStream({
    onUpdate: (rawText) => {
      const finalText = postProcess ? postProcess(rawText) : rawText
      setDisplayedContent(finalText)
    },
    streamDone: isStreamDone,
    minDelay: streamMinDelay,
    initialText: block.content
  })

  useEffect(() => {
    const newContent = block.content || ''
    const oldContent = prevContentRef.current || ''

    const isDifferentBlock = block.id !== prevBlockIdRef.current
    const isContentReset = Boolean(oldContent) && !newContent.startsWith(oldContent)

    if (isDifferentBlock || isContentReset) {
      scannerRef.current?.reset()
      reset(newContent)
    } else {
      const delta = newContent.substring(oldContent.length)
      if (delta) {
        addChunk(delta)
      }
    }

    prevContentRef.current = newContent
    prevBlockIdRef.current = block.id
  }, [block.content, block.id, addChunk, reset])

  const committedRef = useRef<{
    blockId: string
    rawPrefix: string
    segments: CommittedMarkdownSegment[]
    totalProcessedChars: number
    totalProcessedLines: number
    totalRawLines: number
    headingCounts: ReadonlyMap<string, number>
    hasMath: boolean
    hasRaw: boolean
    hasStyle: boolean
  }>({
    blockId: block.id,
    rawPrefix: '',
    segments: [],
    totalProcessedChars: 0,
    totalProcessedLines: 0,
    totalRawLines: 0,
    headingCounts: new Map(),
    hasMath: false,
    hasRaw: false,
    hasStyle: false
  })

  const {
    segments,
    tailContent,
    tailCharOffset,
    tailLineOffset,
    tailRawCharOffset,
    tailRawLineOffset,
    tailHeadingCounts,
    prefixHasMath,
    prefixHasRaw,
    prefixHasStyle
  } = useMemo(() => {
    const clearCommitted = () => {
      committedRef.current = {
        blockId: block.id,
        rawPrefix: '',
        segments: [],
        totalProcessedChars: 0,
        totalProcessedLines: 0,
        totalRawLines: 0,
        headingCounts: new Map(),
        hasMath: false,
        hasRaw: false,
        hasStyle: false
      }
    }

    if ('status' in block && block.status === 'paused' && isEmpty(block.content)) {
      const pausedText = t('message.chat.completion.paused')
      clearCommitted()
      return {
        segments: [] as CommittedMarkdownSegment[],
        tailContent: pausedText,
        tailCharOffset: 0,
        tailLineOffset: 0,
        tailRawCharOffset: 0,
        tailRawLineOffset: 0,
        tailHeadingCounts: undefined,
        prefixHasMath: false,
        prefixHasRaw: false,
        prefixHasStyle: false
      }
    }

    if (!isStreamingBlock) {
      const fullProcessed = removeSvgEmptyLines(processLatexBrackets(displayedContent))
      clearCommitted()
      return {
        segments: [] as CommittedMarkdownSegment[],
        tailContent: fullProcessed,
        tailCharOffset: 0,
        tailLineOffset: 0,
        tailRawCharOffset: 0,
        tailRawLineOffset: 0,
        tailHeadingCounts: undefined,
        prefixHasMath: false,
        prefixHasRaw: false,
        prefixHasStyle: false
      }
    }

    scannerRef.current ??= createStreamingMarkdownScanner()
    const split = scannerRef.current.scan(displayedContent)
    if (!split.prefix) {
      const fullProcessed = removeSvgEmptyLines(processLatexBrackets(displayedContent))
      clearCommitted()
      return {
        segments: [] as CommittedMarkdownSegment[],
        tailContent: fullProcessed,
        tailCharOffset: 0,
        tailLineOffset: 0,
        tailRawCharOffset: 0,
        tailRawLineOffset: 0,
        tailHeadingCounts: undefined,
        prefixHasMath: false,
        prefixHasRaw: false,
        prefixHasStyle: false
      }
    }

    let state = committedRef.current
    if (
      state.blockId !== block.id ||
      (state.rawPrefix.length > 0 && !displayedContent.startsWith(state.rawPrefix)) ||
      split.prefix.length < state.rawPrefix.length
    ) {
      clearCommitted()
      state = committedRef.current
    }

    const uncommittedPrefixDelta = split.prefix.length - state.rawPrefix.length
    if (uncommittedPrefixDelta >= STREAM_PREFIX_STEP_CHARS || state.rawPrefix.length === 0) {
      const rawChunk = split.prefix.slice(state.rawPrefix.length)
      const processedChunk = removeSvgEmptyLines(processLatexBrackets(rawChunk))
      const rawChunkLines = countNewlines(rawChunk)
      const processedChunkLines = countNewlines(processedChunk)
      const nextHeadingCounts = advanceHeadingCounts(processedChunk, state.headingCounts)
      const nextSegment: CommittedMarkdownSegment = {
        key: `seg-${state.rawPrefix.length}`,
        processed: processedChunk,
        charOffset: state.totalProcessedChars,
        lineOffset: state.totalProcessedLines,
        rawCharOffset: state.rawPrefix.length,
        rawLineOffset: state.totalRawLines,
        initialHeadingCounts: state.headingCounts.size > 0 ? state.headingCounts : undefined
      }
      state = {
        blockId: block.id,
        rawPrefix: split.prefix,
        segments: [...state.segments, nextSegment],
        totalProcessedChars: state.totalProcessedChars + processedChunk.length,
        totalProcessedLines: state.totalProcessedLines + processedChunkLines,
        totalRawLines: state.totalRawLines + rawChunkLines,
        headingCounts: nextHeadingCounts,
        hasMath: state.hasMath || HAS_MATH_SYNTAX_REGEX.test(processedChunk),
        hasRaw: state.hasRaw || ALLOWED_ELEMENTS.test(processedChunk),
        hasStyle: state.hasStyle || STYLE_ELEMENT_REGEX.test(processedChunk)
      }
      committedRef.current = state
    }

    const processedTail = removeSvgEmptyLines(processLatexBrackets(displayedContent.slice(state.rawPrefix.length)))
    return {
      segments: state.segments,
      tailContent: processedTail,
      tailCharOffset: state.totalProcessedChars,
      tailLineOffset: state.totalProcessedLines,
      tailRawCharOffset: state.rawPrefix.length,
      tailRawLineOffset: state.totalRawLines,
      tailHeadingCounts: state.headingCounts.size > 0 ? state.headingCounts : undefined,
      prefixHasMath: state.hasMath,
      prefixHasRaw: state.hasRaw,
      prefixHasStyle: state.hasStyle
    }
  }, [block, displayedContent, isStreamingBlock, t])

  const hasMathSyntax = useMemo(
    () => mathEngine !== 'none' && (prefixHasMath || HAS_MATH_SYNTAX_REGEX.test(tailContent)),
    [mathEngine, prefixHasMath, tailContent]
  )

  useEffect(() => {
    if (!hasMathSyntax || mathEngine === 'none' || katexPlugin) {
      return
    }
    let cancelled = false
    void loadKatexPlugin()
      .then((resolved) => {
        if (!cancelled) {
          setKatexPlugin(() => resolved)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hasMathSyntax, mathEngine, katexPlugin])

  const activeMathPlugin = !hasMathSyntax || mathEngine === 'none' ? null : katexPlugin

  const remarkPlugins = useMemo(() => {
    const plugins = [
      [remarkGfm, { singleTilde: false }] as Pluggable,
      [remarkAlert] as Pluggable,
      remarkCjkFriendly,
      remarkCjkAutolinkLiteral,
      remarkDisableConstructs(['codeIndented'])
    ]
    if (activeMathPlugin) {
      plugins.push([remarkMath, { singleDollarTextMath: mathEnableSingleDollar }])
    }
    return plugins
  }, [activeMathPlugin, mathEnableSingleDollar])

  const hasRawElements = useMemo(() => prefixHasRaw || ALLOWED_ELEMENTS.test(tailContent), [prefixHasRaw, tailContent])
  const hasStyleElement = useMemo(
    () => prefixHasStyle || STYLE_ELEMENT_REGEX.test(tailContent),
    [prefixHasStyle, tailContent]
  )

  const rehypePlugins = useMemo(() => {
    const plugins: Pluggable[] = []
    if (hasRawElements) {
      plugins.push(rehypeRaw, rehypeScalableSvg)
    }
    plugins.push([rehypeHeadingIds, { prefix: `heading-${block.id}` }])
    if (activeMathPlugin) {
      plugins.push(activeMathPlugin)
    }
    return plugins
  }, [activeMathPlugin, hasRawElements, block.id])

  const baseComponents = useMemo(() => {
    return {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => <CodeBlock {...props} blockId={block.id} />,
      table: (props: any) => <Table {...props} blockId={block.id} />,
      img: (props: any) => (
        <Suspense fallback={null}>
          <LazyImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />
        </Suspense>
      ),
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      },
      svg: MarkdownSvgRenderer
    } as Partial<Components>
  }, [block.id])

  const urlTransform = useCallback((value: string) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value)
  }, [])

  const footnoteLabel = t('common.footnotes')

  return (
    <div className="markdown">
      {segments.map((seg) => (
        <MarkdownSegment
          key={seg.key}
          content={seg.processed}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
          baseComponents={baseComponents}
          hasStyleElement={hasStyleElement}
          blockId={block.id}
          lineOffset={seg.lineOffset}
          charOffset={seg.charOffset}
          rawLineOffset={seg.rawLineOffset}
          rawCharOffset={seg.rawCharOffset}
          initialHeadingCounts={seg.initialHeadingCounts}
          urlTransform={urlTransform}
          footnoteLabel={footnoteLabel}
        />
      ))}
      <MarkdownSegment
        key={segments.length > 0 ? 'streaming-tail' : 'primary'}
        content={tailContent}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        baseComponents={baseComponents}
        hasStyleElement={hasStyleElement}
        blockId={block.id}
        lineOffset={tailLineOffset}
        charOffset={tailCharOffset}
        rawLineOffset={tailRawLineOffset}
        rawCharOffset={tailRawCharOffset}
        initialHeadingCounts={tailHeadingCounts}
        urlTransform={urlTransform}
        footnoteLabel={footnoteLabel}
      />
    </div>
  )
}

export default memo(Markdown)
