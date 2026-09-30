import WindowCaptureButton from '@renderer/pages/home/Inputbar/tools/components/WindowCaptureButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'

const windowCaptureTool = defineTool({
  key: 'window_capture',
  condition: () => runtimeCapabilities.screenCapture,
  label: (t) => t('chat.input.capture.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'mini-window'],
  dependencies: {
    state: ['couldAddImageFile'] as const,
    actions: ['setFiles'] as const
  },
  render: ({ state, actions, quickPanel }) => (
    <WindowCaptureButton
      couldAddImageFile={state.couldAddImageFile}
      quickPanel={quickPanel}
      setFiles={actions.setFiles}
    />
  )
})

registerTool(windowCaptureTool)

export default windowCaptureTool
