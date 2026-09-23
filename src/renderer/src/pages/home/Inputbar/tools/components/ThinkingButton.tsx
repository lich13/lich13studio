import { ActionIconButton } from '@renderer/components/Buttons'
import { MdiLightbulbOn } from '@renderer/components/Icons/SVGIcon'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { getProviderById } from '@renderer/services/ProviderService'
import type { Model, ThinkingOption } from '@renderer/types'
import { anthropicEffort, anthropicThinkingMode, normalizeReasoningEffort, REASONING_EFFORTS } from '@shared/reasoning'
import { Tooltip } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  model: Model
  assistantId: string
  reasoningEffort?: ThinkingOption
  onReasoningEffortChange?: (option: ThinkingOption) => void
}

const descriptions = {
  low: 'assistants.settings.reasoning_effort.low_description',
  medium: 'assistants.settings.reasoning_effort.medium_description',
  high: 'assistants.settings.reasoning_effort.high_description',
  xhigh: 'assistants.settings.reasoning_effort.xhigh_description',
  max: 'assistants.settings.reasoning_effort.max_description'
} as const

const ThinkingButton: FC<Props> = ({ quickPanel, model, assistantId, reasoningEffort, onReasoningEffortChange }) => {
  const { t } = useTranslation()
  const panel = useQuickPanel()
  const { assistant, updateAssistantSettings } = useAssistant(assistantId)
  const current = normalizeReasoningEffort(reasoningEffort ?? assistant.settings?.reasoning_effort)
  const open = useCallback(
    () =>
      panel.open({
        title: t('assistants.settings.reasoning_effort.label'),
        symbol: QuickPanelReservedSymbol.Thinking,
        list: REASONING_EFFORTS.map((effort) => {
          const isAnthropic = getProviderById(model.provider)?.type === 'anthropic'
          const mapped = anthropicEffort(model.id, effort)
          const mode = anthropicThinkingMode(model.id)
          const description =
            isAnthropic && mode === 'budget'
              ? t('assistants.settings.reasoning_effort.budget_description')
              : isAnthropic && mapped !== effort
                ? t('assistants.settings.reasoning_effort.mapped_description', { effort: mapped })
                : t(descriptions[effort])
          return {
            label: effort,
            description,
            isSelected: current === effort,
            icon: <MdiLightbulbOn width={18} height={18} />,
            action: () => {
              if (onReasoningEffortChange) onReasoningEffortChange(effort)
              else updateAssistantSettings({ reasoning_effort: effort, reasoning_effort_cache: effort })
            }
          }
        })
      }),
    [panel, model, current, onReasoningEffortChange, updateAssistantSettings, t]
  )
  useEffect(() => quickPanel.registerTrigger(QuickPanelReservedSymbol.Thinking, open), [quickPanel, open])
  const label = `${t('assistants.settings.reasoning_effort.label')}: ${current}`
  return (
    <Tooltip title={label}>
      <ActionIconButton active aria-label={label} onClick={open}>
        <MdiLightbulbOn className="icon" width={18} height={18} />
      </ActionIconButton>
    </Tooltip>
  )
}
export default ThinkingButton
