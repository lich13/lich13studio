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
import { isEmpty } from 'lodash'
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

  return (
    <div className="markdown">
      <ReactMarkdown
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        components={components}
        disallowedElements={DISALLOWED_ELEMENTS}
        urlTransform={urlTransform}
        remarkRehypeOptions={{
          footnoteLabel: t('common.footnotes'),
          footnoteLabelTagName: 'h4',
          footnoteBackContent: ' '
        }}>
        {messageContent}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
