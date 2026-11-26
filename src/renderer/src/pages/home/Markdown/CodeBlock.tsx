import { CodeBlockView, HtmlArtifactsCard } from '@renderer/components/CodeBlockView'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppSelector } from '@renderer/store'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { getCodeBlockId, isOpenFenceBlock } from '@renderer/utils/markdown'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'

interface Props {
  children: string
  className?: string
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  [key: string]: any
}

const FencedCodeBlock: React.FC<{
  children: string
  detectedLanguage: string
  rawLanguage?: string
  node?: Omit<Node, 'type'>
  blockId: string
}> = ({ children, detectedLanguage, rawLanguage, node, blockId }) => {
  const codeFancyBlock = useAppSelector((state) => state.settings.codeFancyBlock)
  const isStreaming = useAppSelector(
    (state) => state.messageBlocks.entities[blockId]?.status === MessageBlockStatus.STREAMING
  )

  const language = useMemo(() => {
    return detectedLanguage !== 'xml'
      ? detectedLanguage
      : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(children)
        ? 'svg'
        : detectedLanguage
  }, [children, detectedLanguage])

  const id = getCodeBlockId(node?.position?.start)

  const handleSave = useCallback(
    (newContent: string) => {
      if (id !== undefined) {
        void EventEmitter.emit(EVENT_NAMES.EDIT_CODE_BLOCK, {
          msgBlockId: blockId,
          codeBlockId: id,
          newContent
        })
      }
    },
    [blockId, id]
  )

  if (codeFancyBlock && language === 'html') {
    const isOpenFence = isOpenFenceBlock(children?.length, rawLanguage?.length, node?.position)
    return <HtmlArtifactsCard html={children} onSave={handleSave} isStreaming={isStreaming && isOpenFence} />
  }

  return (
    <CodeBlockView language={language} isStreaming={isStreaming} onSave={handleSave}>
      {children}
    </CodeBlockView>
  )
}

const CodeBlock: React.FC<Props> = ({ children, className, node, blockId }) => {
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = typeof children === 'string' && children.includes('\n')
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)

  if (detectedLanguage === null) {
    return (
      <code className={className} style={{ textWrap: 'wrap', fontSize: '95%', padding: '2px 4px' }}>
        {children}
      </code>
    )
  }

  return (
    <FencedCodeBlock detectedLanguage={detectedLanguage} rawLanguage={languageMatch?.[1]} node={node} blockId={blockId}>
      {children}
    </FencedCodeBlock>
  )
}

export function areCodeBlockPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.children === next.children &&
    prev.className === next.className &&
    prev.blockId === next.blockId &&
    prev.node?.position?.start?.offset === next.node?.position?.start?.offset &&
    prev.node?.position?.end?.offset === next.node?.position?.end?.offset &&
    prev.node?.position?.start?.line === next.node?.position?.start?.line &&
    prev.node?.position?.end?.line === next.node?.position?.end?.line
  )
}

export default memo(CodeBlock, areCodeBlockPropsEqual)
