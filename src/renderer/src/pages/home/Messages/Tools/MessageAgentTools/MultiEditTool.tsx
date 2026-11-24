import type { CollapseProps } from 'antd'

import { ClickableFilePath } from './ClickableFilePath'
import { DiffStyleToggle, useDiffStyle } from './DiffStyleToggle'
import { ToolHeader } from './GenericTools'
import { SimpleTextDiff } from './SimpleTextDiff'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

function MultiEditToolChildren({ input }: { input?: MultiEditToolInput }) {
  const { diffStyle, toggleDiffStyle } = useDiffStyle()
  const edits = Array.isArray(input?.edits) ? input.edits : []

  return (
    <div className="relative space-y-2">
      <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      {edits.map((edit, index) => (
        <SimpleTextDiff
          key={index}
          oldString={edit.old_string ?? ''}
          newString={edit.new_string ?? ''}
          diffStyle={diffStyle}
        />
      ))}
    </div>
  )
}

export function MultiEditTool({
  input
}: {
  input?: MultiEditToolInput
  output?: MultiEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.MultiEdit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.MultiEdit}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <MultiEditToolChildren input={input} />
  }
}
