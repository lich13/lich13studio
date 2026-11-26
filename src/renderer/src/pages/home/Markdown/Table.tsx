import { loggerService } from '@logger'
import { CopyIcon } from '@renderer/components/Icons'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { Tooltip } from 'antd'
import { Check, FileSpreadsheet } from 'lucide-react'
import React, { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import type { Node } from 'unist'

const logger = loggerService.withContext('Table')

interface Props {
  children: React.ReactNode
  node?: Omit<Node, 'type'>
  blockId?: string
  lineOffset?: number
  charOffset?: number
  getSegmentContent?: () => string
}

/**
 * 自定义 Markdown 表格组件，提供 copy 功能。
 */
const Table: React.FC<Props> = ({ children, node, blockId, lineOffset = 0, charOffset = 0, getSegmentContent }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const tableRef = useRef<HTMLTableElement | null>(null)

  const handleCopyTable = useCallback(async () => {
    const tableMarkdown = extractTableMarkdown(
      blockId ?? '',
      node?.position,
      lineOffset,
      charOffset,
      getSegmentContent?.()
    )
    if (!tableMarkdown) {
      window.toast?.error(t('message.error.table.invalid'))
      return
    }

    try {
      const tableHtml = tableRef.current?.outerHTML || ''

      if (tableHtml && navigator.clipboard && window.ClipboardItem) {
        const clipboardItem = new ClipboardItem({
          'text/plain': new Blob([tableMarkdown], { type: 'text/plain' }),
          'text/html': new Blob([tableHtml], { type: 'text/html' })
        })
        await navigator.clipboard.write([clipboardItem])
      } else {
        await navigator.clipboard.writeText(tableMarkdown)
      }
      setCopied(true)
    } catch (error) {
      logger.error('Failed to copy table to clipboard', { error })
      window.toast?.error(t('message.copy.failed'))
    }
  }, [blockId, charOffset, getSegmentContent, lineOffset, node?.position, setCopied, t])

  const handleExportExcel = useCallback(async () => {
    const tableMarkdown = extractTableMarkdown(
      blockId ?? '',
      node?.position,
      lineOffset,
      charOffset,
      getSegmentContent?.()
    )
    if (!tableMarkdown) {
      window.toast?.error(t('message.error.table.invalid'))
      return
    }

    try {
      const { exportTableToExcel } = await import('@renderer/utils/exportExcel')
      const result = await exportTableToExcel(tableMarkdown)
      if (result) {
        window.toast?.success(t('message.success.excel.export'))
      }
    } catch (error) {
      logger.error('Failed to export table to Excel', { error })
      window.toast?.error(t('message.error.excel.export'))
    }
  }, [blockId, charOffset, getSegmentContent, lineOffset, node?.position, t])

  return (
    <TableWrapper className="table-wrapper">
      <table ref={tableRef}>{children}</table>
      <ToolbarWrapper className="table-toolbar">
        <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
          <ToolButton role="button" aria-label={t('common.copy')} onClick={handleCopyTable}>
            {copied ? <Check size={14} color="var(--color-primary)" /> : <CopyIcon size={14} />}
          </ToolButton>
        </Tooltip>
        <Tooltip title={t('common.export.excel')} mouseEnterDelay={0.8}>
          <ToolButton role="button" aria-label={t('common.export.excel')} onClick={handleExportExcel}>
            <FileSpreadsheet size={14} />
          </ToolButton>
        </Tooltip>
      </ToolbarWrapper>
    </TableWrapper>
  )
}

function sliceByLineRange(content: string, startLineOneBased: number, endLineOneBased: number): string {
  if (startLineOneBased < 1 || endLineOneBased < startLineOneBased) {
    return ''
  }
  let currentLine = 1
  let pos = 0
  while (currentLine < startLineOneBased && pos < content.length) {
    const nextNl = content.indexOf('\n', pos)
    if (nextNl === -1) return ''
    pos = nextNl + 1
    currentLine += 1
  }
  const sliceStart = pos
  while (currentLine < endLineOneBased && pos < content.length) {
    const nextNl = content.indexOf('\n', pos)
    if (nextNl === -1) {
      return content.slice(sliceStart).trim()
    }
    pos = nextNl + 1
    currentLine += 1
  }
  const lineEndNl = content.indexOf('\n', pos)
  const sliceEnd = lineEndNl === -1 ? content.length : lineEndNl
  return content.slice(sliceStart, sliceEnd).trim()
}

/**
 * 从原始 Markdown 内容中提取表格源代码
 * @param blockId 消息块 ID
 * @param position 表格节点的位置信息
 * @returns 源代码
 */
export function extractTableMarkdown(
  blockId: string,
  position: any,
  lineOffset: number = 0,
  charOffset: number = 0,
  sourceMarkdown?: string
): string {
  if (!position) return ''
  const { start, end } = position

  if (
    typeof sourceMarkdown === 'string' &&
    typeof start?.offset === 'number' &&
    typeof end?.offset === 'number' &&
    start.offset >= 0 &&
    end.offset <= sourceMarkdown.length &&
    start.offset < end.offset
  ) {
    return sourceMarkdown.slice(start.offset, end.offset).trim()
  }

  if (!blockId) return ''

  const block = messageBlocksSelectors.selectById(store.getState(), blockId)
  if (!block || !('content' in block) || typeof block.content !== 'string') return ''

  const content = block.content

  if (typeof start?.offset === 'number' && typeof end?.offset === 'number') {
    const rawStart = start.offset + charOffset
    const rawEnd = end.offset + charOffset
    // processLatexBrackets only alters character offsets on `\( ... \)` and removeSvgEmptyLines on `<svg`.
    if (
      rawStart >= 0 &&
      rawEnd <= content.length &&
      rawStart < rawEnd &&
      !content.includes('\\(') &&
      !/<svg[\s>]/i.test(content)
    ) {
      return content.slice(rawStart, rawEnd).trim()
    }
  }

  if (typeof start?.line === 'number' && typeof end?.line === 'number') {
    if (!/<svg[\s>]/i.test(content)) {
      return sliceByLineRange(content, start.line + lineOffset, end.line + lineOffset)
    }
    const processed = content.replace(/(<svg[\s\S]*?<\/svg>)/gi, (svgMatch) =>
      svgMatch
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n')
    )
    return sliceByLineRange(processed, start.line + lineOffset, end.line + lineOffset)
  }

  return ''
}

const TableWrapper = styled.div`
  position: relative;

  .table-toolbar {
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
  }
  &:hover {
    .table-toolbar {
      opacity: 1;
    }
  }
`

const ToolbarWrapper = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  display: flex;
  gap: 4px;
`

const ToolButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  opacity: 1;
  color: var(--color-text-3);
  background-color: var(--color-background-mute);
  will-change: background-color, opacity;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

function serializeTableNodeSignature(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(serializeTableNodeSignature).join('|')
  }
  if (React.isValidElement(node)) {
    const props = (node.props ?? {}) as Record<string, unknown>
    const tag = typeof node.type === 'string' ? node.type : ''
    const attrs = `${String(props.href ?? '')}:${String(props.src ?? '')}:${String(props.className ?? '')}`
    return `<${tag}:${attrs}>${serializeTableNodeSignature(props.children as React.ReactNode)}</${tag}>`
  }
  return ''
}

export function areTablePropsEqual(prev: Props, next: Props): boolean {
  const prevStart = prev.node?.position?.start
  const nextStart = next.node?.position?.start
  const prevEnd = prev.node?.position?.end
  const nextEnd = next.node?.position?.end
  const prevLineOffset = prev.lineOffset ?? 0
  const nextLineOffset = next.lineOffset ?? 0
  const prevCharOffset = prev.charOffset ?? 0
  const nextCharOffset = next.charOffset ?? 0
  if (prev.blockId !== next.blockId || prevLineOffset !== nextLineOffset || prevCharOffset !== nextCharOffset) {
    return false
  }
  if (prev.children === next.children) {
    return (
      prevStart?.line === nextStart?.line &&
      prevEnd?.line === nextEnd?.line &&
      prevStart?.offset === nextStart?.offset &&
      prevEnd?.offset === nextEnd?.offset
    )
  }
  if (
    prev.blockId &&
    prevStart?.offset !== undefined &&
    prevEnd?.offset !== undefined &&
    prevStart.offset === nextStart?.offset &&
    prevEnd.offset === nextEnd?.offset &&
    prevStart.line === nextStart?.line &&
    prevEnd.line === nextEnd?.line
  ) {
    return serializeTableNodeSignature(prev.children) === serializeTableNodeSignature(next.children)
  }
  return false
}

export default memo(Table, areTablePropsEqual)
