import 'remark-github-blockquote-alert/alert.css'

import ImageViewer from '@renderer/components/ImageViewer'
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
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup|details|summary)/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']
const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HAS_MATH_SYNTAX_REGEX = /\$|(?:^|\n)\s*(?:`{3,}|~{3,})\s*math\b/i
const STREAM_SEGMENT_MIN_CHARS = 1600
const STREAM_TAIL_KEEP_CHARS = 400
const STREAM_PREFIX_STEP_CHARS = 1024
const UNSAFE_PREFIX_SPLIT_DOC_REGEX = /\[\^|\]:\s|\]\[|<\/?(?:details|summary|table|svg|div|style)\b/i
const LIST_OR_QUOTE_MARKER_REGEX = /^(?:>|\d+[.)]\s|[-*+]\s)/
const UNSAFE_NEXT_LINE_REGEX = /^(?:\||>|\d+[.)]\s|[-*+]\s|={2,}\s*$|-{2,}\s*$)/

export function splitStreamingMarkdownPrefix(content: string): { prefix: string; tail: string } {
  if (content.length < STREAM_SEGMENT_MIN_CHARS || UNSAFE_PREFIX_SPLIT_DOC_REGEX.test(content)) {
    return { prefix: '', tail: content }
  }
  const targetMaxSplit = content.length - STREAM_TAIL_KEEP_CHARS
  let activeFenceChar = ''
  let activeFenceLen = 0
  let inDisplayMath = false
  let inListOrQuote = false
  let lastSafeSplit = 0
  let lineStart = 0

  while (lineStart < content.length) {
    const newlineIdx = content.indexOf('\n', lineStart)
    const lineEnd = newlineIdx === -1 ? content.length : newlineIdx
    const line = content.slice(lineStart, lineEnd)
    const trimmed = line.trimStart()

    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      const char = fenceMatch[1][0]
      const len = fenceMatch[1].length
      if (!activeFenceChar) {
        activeFenceChar = char
        activeFenceLen = len
      } else if (char === activeFenceChar && len >= activeFenceLen && trimmed.slice(len).trim() === '') {
        activeFenceChar = ''
        activeFenceLen = 0
      }
    } else if (!activeFenceChar && trimmed.startsWith('$$')) {
      const occurrences = line.split('$$').length - 1
      if (occurrences % 2 === 1) {
        inDisplayMath = !inDisplayMath
      }
    } else if (!activeFenceChar && !inDisplayMath && trimmed !== '') {
      if (LIST_OR_QUOTE_MARKER_REGEX.test(trimmed)) {
        inListOrQuote = true
      } else if (!/^[ \t]{2,}/.test(line)) {
        inListOrQuote = false
      }
    }

    if (
      !activeFenceChar &&
      !inDisplayMath &&
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

  const messageContent = useMemo(() => {
    if ('status' in block && block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    return removeSvgEmptyLines(processLatexBrackets(displayedContent))
  }, [block, displayedContent, t])

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
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
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
  const isStreamingBlock = 'status' in block && block.status === 'streaming'
  const cachedPrefixRef = useRef<{ blockId: string; prefix: string }>({ blockId: block.id, prefix: '' })

  const { prefixContent, tailContent, prefixLines } = useMemo(() => {
    if (!isStreamingBlock) {
      cachedPrefixRef.current = { blockId: block.id, prefix: '' }
      return { prefixContent: '', tailContent: messageContent, prefixLines: 0 }
    }
    const split = splitStreamingMarkdownPrefix(messageContent)
    if (!split.prefix) {
      cachedPrefixRef.current = { blockId: block.id, prefix: '' }
      return { prefixContent: '', tailContent: messageContent, prefixLines: 0 }
    }
    const prev = cachedPrefixRef.current
    const activePrefix =
      prev.blockId === block.id &&
      prev.prefix.length > 0 &&
      messageContent.startsWith(prev.prefix) &&
      split.prefix.length - prev.prefix.length < STREAM_PREFIX_STEP_CHARS
        ? prev.prefix
        : split.prefix
    cachedPrefixRef.current = { blockId: block.id, prefix: activePrefix }
    let lines = 0
    for (let i = 0; i < activePrefix.length; i += 1) {
      if (activePrefix.charCodeAt(i) === 10) lines += 1
    }
    return {
      prefixContent: activePrefix,
      tailContent: messageContent.slice(activePrefix.length),
      prefixLines: lines
    }
  }, [block.id, isStreamingBlock, messageContent])

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
