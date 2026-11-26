import Scrollbar from '@renderer/components/Scrollbar'
import type { RootState } from '@renderer/store'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { scrollIntoView } from '@renderer/utils/dom'
import type { FC } from 'react'
import React, { useMemo, useRef } from 'react'
import { shallowEqual, useSelector } from 'react-redux'
import remarkParse from 'remark-parse'
import styled from 'styled-components'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { createSlugger, extractTextFromNode } from '../Markdown/plugins/rehypeHeadingIds'

interface MessageOutlineProps {
  message: Message
}

interface HeadingItem {
  id: string
  level: number
  text: string
}

function stripInlineHeadingMarkup(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
}

function scanStreamingHeadings(blockId: string, content: string): HeadingItem[] {
  if (!content) return []
  const slugger = createSlugger()
  const items: HeadingItem[] = []
  let fenceChar: string | null = null
  let fenceLen = 0
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      const trailing = fenceMatch[2]
      if (!fenceChar) {
        fenceChar = marker[0]
        fenceLen = marker.length
        continue
      }
      if (marker[0] === fenceChar && marker.length >= fenceLen && /^\s*$/.test(trailing)) {
        fenceChar = null
        fenceLen = 0
        continue
      }
    }
    if (fenceChar) continue

    const atxMatch = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+[ \t]*)?$/.exec(line)
    if (atxMatch && (atxMatch[2] !== undefined || line.trim() === atxMatch[1])) {
      const text = stripInlineHeadingMarkup(atxMatch[2] ?? '')
      if (text) {
        items.push({
          id: `heading-${blockId}--${slugger.slug(text)}`,
          level: atxMatch[1].length,
          text
        })
      }
      continue
    }

    const htmlMatch = /<h([1-6])[^>]*>(.*?)<\/h\1>/i.exec(line)
    if (htmlMatch) {
      const level = parseInt(htmlMatch[1], 10)
      const text = htmlMatch[2].replace(/<[^>]*>/g, '').trim()
      if (text) {
        items.push({
          id: `heading-${blockId}--${slugger.slug(text)}`,
          level,
          text
        })
      }
    }
  }

  return items
}

const MessageOutline: FC<MessageOutlineProps> = ({ message }) => {
  const mainTextBlocks = useSelector(
    (state: RootState) =>
      message.blocks
        .map((blockId) => state.messageBlocks.entities[blockId])
        .filter((b): b is MainTextMessageBlock => b?.type === MessageBlockType.MAIN_TEXT),
    shallowEqual
  )

  const headings: HeadingItem[] = useMemo(() => {
    if (!mainTextBlocks?.length) return []

    const result: HeadingItem[] = []
    mainTextBlocks.forEach((mainTextBlock) => {
      if (mainTextBlock.status === MessageBlockStatus.STREAMING) {
        result.push(...scanStreamingHeadings(mainTextBlock.id, mainTextBlock.content))
        return
      }
      const tree = unified().use(remarkParse).parse(mainTextBlock?.content)
      const slugger = createSlugger()
      visit(tree, ['heading', 'html'], (node) => {
        if (node.type === 'heading') {
          const level = node.depth ?? 0
          if (!level || level < 1 || level > 6) return
          const text = extractTextFromNode(node)
          if (!text) return
          const id = `heading-${mainTextBlock.id}--` + slugger.slug(text || '')
          result.push({ id, level, text: text })
        } else if (node.type === 'html') {
          const match = node.value.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/i)
          if (match) {
            const level = parseInt(match[1], 10)
            const text = match[2].replace(/<[^>]*>/g, '').trim()
            if (text) {
              const id = `heading-${mainTextBlock.id}--${slugger.slug(text || '')}`
              result.push({ id, level, text })
            }
          }
        }
      })
    })

    return result
  }, [mainTextBlocks])

  const miniLevel = useMemo(() => {
    return headings.length ? Math.min(...headings.map((heading) => heading.level)) : 1
  }, [headings])

  const messageOutlineContainerRef = useRef<HTMLDivElement>(null)
  const scrollToHeading = (id: string) => {
    const parent = messageOutlineContainerRef.current?.parentElement
    const messageContentContainer = parent?.querySelector('.message-content-container')
    if (messageContentContainer) {
      const headingElement = messageContentContainer.querySelector<HTMLElement>(`#${id}`)
      if (headingElement) {
        const scrollBlock = ['horizontal', 'grid'].includes(message.multiModelMessageStyle ?? '') ? 'nearest' : 'start'
        scrollIntoView(headingElement, { behavior: 'smooth', block: scrollBlock, container: 'nearest' })
      }
    }
  }

  // 暂时不支持 grid，因为在锚点滚动时会导致渲染错位
  if (message.multiModelMessageStyle === 'grid' || !headings.length) return null

  return (
    <MessageOutlineContainer ref={messageOutlineContainerRef}>
      <MessageOutlineBody $count={headings.length}>
        {headings.map((heading, index) => (
          <MessageOutlineItem key={index} onClick={() => scrollToHeading(heading.id)}>
            <MessageOutlineItemDot $level={heading.level} />
            <MessageOutlineItemText $level={heading.level} $miniLevel={miniLevel}>
              {heading.text}
            </MessageOutlineItemText>
          </MessageOutlineItem>
        ))}
      </MessageOutlineBody>
    </MessageOutlineContainer>
  )
}

const MessageOutlineContainer = styled.div`
  position: absolute;
  inset: 63px 0 36px 10px;
  z-index: 999;
  pointer-events: none;
  & ~ .message-content-container {
    padding-left: 46px !important;
  }
  & ~ .MessageFooter {
    margin-left: 46px !important;
  }
`

const MessageOutlineItemDot = styled.div<{ $level: number }>`
  width: ${({ $level }) => 16 - $level * 2}px;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin-right: 4px;
  flex-shrink: 0;
  transition: background 0.2s ease;
`

const MessageOutlineItemText = styled.div<{ $level: number; $miniLevel: number }>`
  overflow: hidden;
  color: var(--color-text-3);
  opacity: 0;
  display: none;
  transition: opacity 0.2s ease;
  padding: 2px 8px;
  padding-left: ${({ $level, $miniLevel }) => ($level - $miniLevel) * 8}px;
  font-size: ${({ $level }) => 16 - $level}px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const MessageOutlineItem = styled.div`
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    ${MessageOutlineItemText} {
      color: var(--color-text-2);
    }
    ${MessageOutlineItemDot} {
      background: var(--color-text-3);
    }
  }
`

const MessageOutlineBody = styled(Scrollbar)<{ $count: number }>`
  max-width: 50%;
  max-height: min(100%, 70vh);
  position: sticky;
  top: max(calc(50% - ${({ $count }) => ($count * 24) / 2 + 10}px), 20px);
  bottom: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  display: inline-flex;
  flex-direction: column;
  padding: 10px 0 10px 10px;
  gap: 4px;
  border-radius: 10px;
  pointer-events: auto;
  &:hover {
    padding: 10px 10px 10px 10px;
    overflow-y: auto;
    background: var(--color-background);
    box-shadow: 0 0 10px 0 rgba(128, 128, 128, 0.2);
    ${MessageOutlineItemText} {
      opacity: 1;
      display: block;
    }
  }
`

export default React.memo(MessageOutline)
