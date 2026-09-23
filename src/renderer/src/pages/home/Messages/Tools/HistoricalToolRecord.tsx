import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse } from 'antd'

// Historical records never mount approval, progress or execution hooks.
export default function HistoricalToolRecord({ block }: { block: ToolMessageBlock }) {
  const record = block.metadata?.rawMcpToolResponse
  if (!record) return null
  return (
    <Collapse
      items={[
        {
          key: record.id,
          label: record.tool.name,
          children: (
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify({ arguments: record.arguments, response: record.response }, null, 2)}
            </pre>
          )
        }
      ]}
    />
  )
}
