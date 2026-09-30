import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import { isLocalAi } from '@renderer/config/env'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { useAppSelector } from '@renderer/store'
import type { Assistant } from '@renderer/types'
import { assistantModelSelection, selectionModelReference } from '@shared/modelProviderSelection'

export default function SelectModelButton({ assistant }: { assistant: Assistant }) {
  const { updateAssistant } = useAssistant(assistant.id)
  const llm = useAppSelector((state) => state.llm)
  if (isLocalAi) return null
  return (
    <ModelProviderSelect
      compact
      layout={runtimeCapabilities.android ? 'responsive' : 'inline'}
      showEffort
      selection={assistantModelSelection(assistant, llm)}
      onChange={(modelSelection) => {
        updateAssistant({ modelSelection, model: selectionModelReference(modelSelection, llm) })
      }}
    />
  )
}
