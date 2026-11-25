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
import rehypeHeadingIds from './plugins/rehypeHeadingIds'
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

function updateLineMathAndSvgState(line: string, state: InlineSplitState): void {
  for (let i = 0; i < line.length; i += 1) {
    if (state.inXmlComment) {
      const closeEndIdx = findXmlCommentEnd(line, i)
      if (closeEndIdx === -1) {
        return
      }
      state.inXmlComment = false
      i = closeEndIdx
      continue
    }

    if (state.inCdata) {
      const closeIdx = line.indexOf(']]>', i)
      if (closeIdx === -1) {
        return
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
      state.inlineCodeTickLen = ticks
      i += ticks - 1
      continue
    }

    if (code === 60 /* < */) {
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

    if (state.svgDepth !== 0 || code !== 92 /* \ */ || i + 1 >= line.length) {
      continue
    }
    let backslashes = 1
    while (i + backslashes < line.length && line.charCodeAt(i + backslashes) === 92) {
      backslashes += 1
    }
    const nextCharPos = i + backslashes
    if ((backslashes & 1) === 1 && nextCharPos < line.length) {
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
}

export function splitStreamingMarkdownPrefix(content: string): { prefix: string; tail: string } {
  if (content.length < STREAM_SEGMENT_MIN_CHARS || UNSAFE_PREFIX_SPLIT_DOC_REGEX.test(content)) {
    return { prefix: '', tail: content }
  }
  const targetMaxSplit = content.length - STREAM_TAIL_KEEP_CHARS
  let activeFenceChar = ''
  let activeFenceLen = 0
  let inDisplayMath = false
  let inListOrQuote = false
  const inlineState: InlineSplitState = {
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
  let lastSafeSplit = 0
  let lineStart = 0

  while (lineStart < content.length) {
    const newlineIdx = content.indexOf('\n', lineStart)
    const lineEnd = newlineIdx === -1 ? content.length : newlineIdx
    const line = content.slice(lineStart, lineEnd)
    const trimmed = line.trimStart()

    const fenceMatch =
      !inDisplayMath &&
      !inlineState.inXmlComment &&
      !inlineState.inCdata &&
      inlineState.svgDepth === 0 &&
      inlineState.svgTagMode === 'none' &&
      inlineState.inlineCodeTickLen === 0
        ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
        : null
    let handledAsFence = false
    if (fenceMatch) {
      const char = fenceMatch[1][0]
      const len = fenceMatch[1].length
      const afterFence = fenceMatch[2]
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
      } else if (
        !inlineState.inXmlComment &&
        !inlineState.inCdata &&
        inlineState.svgDepth === 0 &&
        inlineState.svgTagMode === 'none' &&
        inlineState.inlineCodeTickLen === 0 &&
        trimmed.startsWith('$$')
      ) {
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
        updateLineMathAndSvgState(line, inlineState)
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
      newlineIdx !== -1 &&
      newlineIdx + 1 <= targetMaxSplit
    ) {
      const nextLineEnd = content.indexOf('\n', newlineIdx + 1)
      const rawNextLine = content.slice(newlineIdx + 1, nextLineEnd === -1 ? content.length : nextLineEnd)
      const nextTrimmed = rawNextLine.trimStart()
      if (nextTrimmed !== '' && !/^[ \t]{2,}/.test(rawNextLine) && !UNSAFE_NEXT_LINE_REGEX.test(nextTrimmed)) {
        lastSafeSplit = newlineIdx + 1
      }
    }

    if (newlineIdx === -1) break
    lineStart = newlineIdx + 1
  }

  if (lastSafeSplit < STREAM_PREFIX_STEP_CHARS) {
    return { prefix: '', tail: content }
  }
  return {
    prefix: content.slice(0, lastSafeSplit),
    tail: content.slice(lastSafeSplit)
  }
}

const MarkdownSegment = memo(
  ({
    content,
    rehypePlugins,
    remarkPlugins,
    components,
    urlTransform,
    footnoteLabel
  }: {
    content: string
    rehypePlugins: Pluggable[]
    remarkPlugins: Pluggable[]
    components: Partial<Components>
    urlTransform: (value: string) => string
    footnoteLabel: string
  }) => (
    <ReactMarkdown
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      components={components}
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
)
MarkdownSegment.displayName = 'MarkdownSegment'

interface Props {
  block: MainTextMessageBlock | TranslationMessageBlock | ThinkingMessageBlock | CompactMessageBlock
  postProcess?: (text: string) => string
}

let cachedKatexPlugin: Pluggable | null = null
let katexLoadPromise: Promise<Pluggable> | null = null
let cachedMathjaxPlugin: Pluggable | null = null
let mathjaxLoadPromise: Promise<Pluggable> | null = null

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

function loadMathjaxPlugin(): Promise<Pluggable> {
  if (cachedMathjaxPlugin) {
    return Promise.resolve(cachedMathjaxPlugin)
  }
  if (!mathjaxLoadPromise) {
    mathjaxLoadPromise = import('rehype-mathjax')
      .then((mod) => {
        const resolved = (mod.default ?? mod) as Pluggable
        cachedMathjaxPlugin = resolved
        return resolved
      })
      .catch((error) => {
        mathjaxLoadPromise = null
        throw error
      })
  }
  return mathjaxLoadPromise
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const { mathEngine, mathEnableSingleDollar } = useSettings()
  const [katexPlugin, setKatexPlugin] = useState<Pluggable | null>(() => cachedKatexPlugin)
  const [mathjaxPlugin, setMathjaxPlugin] = useState<Pluggable | null>(() => cachedMathjaxPlugin)

  const isTrulyDone = 'status' in block && block.status === 'success'
  const [displayedContent, setDisplayedContent] = useState(postProcess ? postProcess(block.content) : block.content)
  const [isStreamDone, setIsStreamDone] = useState(isTrulyDone)

  const prevContentRef = useRef(block.content)
  const prevBlockIdRef = useRef(block.id)
  const contentLength = block.content?.length ?? 0
  const streamMinDelay = block.status !== 'streaming' ? 10 : contentLength > 8000 ? 48 : contentLength > 3000 ? 32 : 12

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
      reset(newContent)
    } else {
      const delta = newContent.substring(oldContent.length)
      if (delta) {
        addChunk(delta)
      }
    }

    prevContentRef.current = newContent
    prevBlockIdRef.current = block.id

    const isStreaming = block.status === 'streaming'
    setIsStreamDone(!isStreaming)
  }, [block.content, block.id, block.status, addChunk, reset])

  const isStreamingBlock = 'status' in block && block.status === 'streaming'
  const cachedPrefixRef = useRef<{
    blockId: string
    rawPrefix: string
    processedPrefix: string
    prefixLines: number
  }>({
    blockId: block.id,
    rawPrefix: '',
    processedPrefix: '',
    prefixLines: 0
  })

  const { prefixContent, tailContent, prefixLines, messageContent } = useMemo(() => {
    if ('status' in block && block.status === 'paused' && isEmpty(block.content)) {
      const pausedText = t('message.chat.completion.paused')
      cachedPrefixRef.current = { blockId: block.id, rawPrefix: '', processedPrefix: '', prefixLines: 0 }
      return { prefixContent: '', tailContent: pausedText, prefixLines: 0, messageContent: pausedText }
    }

    if (!isStreamingBlock) {
      const fullProcessed = removeSvgEmptyLines(processLatexBrackets(displayedContent))
      cachedPrefixRef.current = { blockId: block.id, rawPrefix: '', processedPrefix: '', prefixLines: 0 }
      return { prefixContent: '', tailContent: fullProcessed, prefixLines: 0, messageContent: fullProcessed }
    }

    const split = splitStreamingMarkdownPrefix(displayedContent)
    if (!split.prefix) {
      const fullProcessed = removeSvgEmptyLines(processLatexBrackets(displayedContent))
      cachedPrefixRef.current = { blockId: block.id, rawPrefix: '', processedPrefix: '', prefixLines: 0 }
      return { prefixContent: '', tailContent: fullProcessed, prefixLines: 0, messageContent: fullProcessed }
    }

    const prev = cachedPrefixRef.current
    const canReusePrefix =
      prev.blockId === block.id &&
      prev.rawPrefix.length > 0 &&
      displayedContent.startsWith(prev.rawPrefix) &&
      split.prefix.length - prev.rawPrefix.length < STREAM_PREFIX_STEP_CHARS

    let activeRawPrefix: string
    let activeProcessedPrefix: string
    let lines: number

    if (canReusePrefix) {
      activeRawPrefix = prev.rawPrefix
      activeProcessedPrefix = prev.processedPrefix
      lines = prev.prefixLines
    } else {
      activeRawPrefix = split.prefix
      activeProcessedPrefix = removeSvgEmptyLines(processLatexBrackets(activeRawPrefix))
      lines = 0
      for (let i = 0; i < activeProcessedPrefix.length; i += 1) {
        if (activeProcessedPrefix.charCodeAt(i) === 10) lines += 1
      }
      cachedPrefixRef.current = {
        blockId: block.id,
        rawPrefix: activeRawPrefix,
        processedPrefix: activeProcessedPrefix,
        prefixLines: lines
      }
    }

    const processedTail = removeSvgEmptyLines(processLatexBrackets(displayedContent.slice(activeRawPrefix.length)))
    return {
      prefixContent: activeProcessedPrefix,
      tailContent: processedTail,
      prefixLines: lines,
      messageContent: activeProcessedPrefix + processedTail
    }
  }, [block, displayedContent, isStreamingBlock, t])

  const hasMathSyntax = useMemo(
    () => mathEngine !== 'none' && HAS_MATH_SYNTAX_REGEX.test(messageContent),
    [mathEngine, messageContent]
  )

  useEffect(() => {
    if (!hasMathSyntax || mathEngine !== 'KaTeX' || katexPlugin) {
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

  useEffect(() => {
    if (!hasMathSyntax || mathEngine !== 'MathJax' || mathjaxPlugin) {
      return
    }
    let cancelled = false
    void loadMathjaxPlugin()
      .then((resolved) => {
        if (!cancelled) {
          setMathjaxPlugin(() => resolved)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hasMathSyntax, mathEngine, mathjaxPlugin])

  const activeMathPlugin =
    !hasMathSyntax || mathEngine === 'none'
      ? null
      : mathEngine === 'KaTeX'
        ? katexPlugin
        : mathEngine === 'MathJax'
          ? mathjaxPlugin
          : null

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

  const hasRawElements = useMemo(() => ALLOWED_ELEMENTS.test(messageContent), [messageContent])
  const hasStyleElement = useMemo(() => STYLE_ELEMENT_REGEX.test(messageContent), [messageContent])

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

  const components = useMemo(
    () => (hasStyleElement ? { ...baseComponents, style: MarkdownShadowDOMRenderer as any } : baseComponents),
    [baseComponents, hasStyleElement]
  )

  const urlTransform = useCallback((value: string) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value)
  }, [])

  const footnoteLabel = t('common.footnotes')
  const prefixCharOffset = prefixContent.length
  const tailComponents = useMemo(() => {
    if (prefixCharOffset === 0) return components
    return {
      ...components,
      code: (props: any) => {
        const pos = props?.node?.position
        const shiftedNode = pos
          ? {
              ...props.node,
              position: {
                start: pos.start
                  ? {
                      ...pos.start,
                      line: pos.start.line + prefixLines,
                      offset: pos.start.offset !== undefined ? pos.start.offset + prefixCharOffset : undefined
                    }
                  : undefined,
                end: pos.end
                  ? {
                      ...pos.end,
                      line: pos.end.line + prefixLines,
                      offset: pos.end.offset !== undefined ? pos.end.offset + prefixCharOffset : undefined
                    }
                  : undefined
              }
            }
          : props.node
        return <CodeBlock {...props} node={shiftedNode} blockId={block.id} />
      },
      table: (props: any) => <Table {...props} blockId={block.id} lineOffset={prefixLines} />
    } as Partial<Components>
  }, [block.id, components, prefixCharOffset, prefixLines])

  return (
    <div className="markdown">
      <MarkdownSegment
        key="primary"
        content={prefixContent || tailContent}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={urlTransform}
        footnoteLabel={footnoteLabel}
      />
      {prefixContent ? (
        <MarkdownSegment
          key="streaming-tail"
          content={tailContent}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
          components={tailComponents}
          urlTransform={urlTransform}
          footnoteLabel={footnoteLabel}
        />
      ) : null}
    </div>
  )
}

export default memo(Markdown)
