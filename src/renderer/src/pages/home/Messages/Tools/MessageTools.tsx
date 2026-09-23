import type { ToolMessageBlock } from '@renderer/types/newMessage'

import HistoricalToolRecord from './HistoricalToolRecord'
import MessageTool from './MessageTool'

interface Props {
  block: ToolMessageBlock
}

export default function MessageTools({ block }: Props) {
  const toolResponse = block.metadata?.rawMcpToolResponse
  if (!toolResponse) return null

  const tool = toolResponse.tool
  if (tool.type === 'mcp' || tool.name.startsWith('mcp__')) {
    return <HistoricalToolRecord block={block} />
  }

  return <MessageTool block={block} />
}
