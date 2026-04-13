import WindowCaptureButton from '@renderer/pages/home/Inputbar/tools/components/WindowCaptureButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

const windowCaptureTool = defineTool({
  key: 'window_capture',
  label: (t) => t('chat.input.capture.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'mini-window'],
  dependencies: {
    state: ['couldAddImageFile'] as const,
    actions: ['setFiles'] as const
  },
  render: ({ state, actions }) => (
    <WindowCaptureButton couldAddImageFile={state.couldAddImageFile} setFiles={actions.setFiles} />
  )
})

registerTool(windowCaptureTool)

export default windowCaptureTool
