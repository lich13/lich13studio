import type { CollapseProps } from 'antd'

import { ClickableFilePath } from './ClickableFilePath'
import { DiffStyleToggle, useDiffStyle } from './DiffStyleToggle'
import { ToolHeader } from './GenericTools'
import { SimpleTextDiff } from './SimpleTextDiff'
import type { EditToolInput, EditToolOutput } from './types'
import { AgentToolsType } from './types'

function EditToolChildren({ input, output }: { input?: EditToolInput; output?: EditToolOutput }) {
  const { diffStyle, toggleDiffStyle } = useDiffStyle()

  return (
    <div className="relative">
      <DiffStyleToggle diffStyle={diffStyle} onToggle={toggleDiffStyle} />
      <SimpleTextDiff oldString={input?.old_string ?? ''} newString={input?.new_string ?? ''} diffStyle={diffStyle} />
      {output}
    </div>
  )
}

export function EditTool({
  input,
  output
}: {
  input?: EditToolInput
  output?: EditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const filename = input?.file_path?.split('/').pop()

  return {
    key: AgentToolsType.Edit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Edit}
        params={input?.file_path ? <ClickableFilePath path={input.file_path} displayName={filename} /> : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <EditToolChildren input={input} output={output} />
  }
}
