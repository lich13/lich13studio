import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { reasoningUsage } from '@renderer/services/ReasoningUsageService'
import { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'
import { type ModelProviderSelection, resolveModelProviderSelection } from '@shared/modelProviderSelection'
import { PLATFORM_NAMES, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import { Select, Typography } from 'antd'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export default function ModelProviderSelect({
  selection,
  onChange,
  compact = false,
  filter,
  showEffort = false
}: {
  selection: ModelProviderSelection
  onChange: (selection: ModelProviderSelection) => void
  compact?: boolean
  showEffort?: boolean
  filter?: (model: Model) => boolean
}) {
  const { t } = useTranslation()
  const llm = useAppSelector((state) => state.llm)
  const resolved = resolveModelProviderSelection(selection, llm)
  const effort = useSyncExternalStore(reasoningUsage.subscribe, () =>
    reasoningUsage.get(selection.providerId || '', selection.modelId || '')
  )
  const models = PROVIDER_PLATFORMS.map((platform) => ({
    label: PLATFORM_NAMES[platform],
    options: llm.platformModels[platform]
      .filter((definition) => {
        const model = { ...definition, provider: '' }
        return !isEmbeddingModel(model) && !isRerankModel(model) && (!filter || filter(model))
      })
      .map((model) => ({
        value: JSON.stringify([platform, model.id]),
        label: model.id === model.name ? model.id : `${model.name} · ${model.id}`,
        disabled: false
      }))
  }))
  if (selection.modelId && !resolved.definition)
    models.push({
      label: t('settings.modelTest.unavailable'),
      options: [
        { value: JSON.stringify([selection.platform, selection.modelId]), label: selection.modelId, disabled: true }
      ]
    })
  const providers = resolved.providers.map((provider) => ({
    value: provider.id,
    label: provider.name,
    disabled: false
  }))
  if (selection.providerId && !resolved.provider)
    providers.push({
      value: selection.providerId,
      label: `${llm.providers.find((provider) => provider.id === selection.providerId)?.name || selection.providerId} (${t('settings.modelTest.unavailable')})`,
      disabled: true
    })
  return (
    <Controls className="nodrag" $compact={compact}>
      <Fields>
        <Select
          aria-label={t('settings.modelTest.modelLabel')}
          showSearch
          optionFilterProp="label"
          size={compact ? 'small' : 'middle'}
          options={models}
          value={selection.modelId ? JSON.stringify([selection.platform, selection.modelId]) : undefined}
          placeholder={t('button.select_model')}
          onChange={(value: string) => {
            const [platform, modelId] = JSON.parse(value) as [ProviderPlatform, string]
            onChange({ ...selection, platform, modelId })
          }}
        />
        <Select
          aria-label={t('settings.modelTest.providerLabel')}
          showSearch
          optionFilterProp="label"
          size={compact ? 'small' : 'middle'}
          options={providers}
          value={selection.providerId}
          placeholder={t('settings.modelTest.providerPlaceholder')}
          disabled={!selection.modelId}
          onChange={(providerId: string) => onChange({ ...selection, providerId })}
        />
      </Fields>
      {showEffort && effort && (
        <Typography.Text type="secondary">
          {t('chat.effectiveReasoning', { requested: effort.requested, effective: effort.effective })}
        </Typography.Text>
      )}
      {resolved.issue && (
        <Typography.Text type="warning" role="status">
          {t(
            resolved.issue === 'modelUnavailable'
              ? 'settings.modelTest.modelUnavailable'
              : 'settings.modelTest.providerUnavailable'
          )}
        </Typography.Text>
      )}
    </Controls>
  )
}

const Controls = styled.div<{ $compact: boolean }>`
  min-width: 0;
  width: ${({ $compact }) => ($compact ? 'min(380px, 100%)' : '100%')};
  -webkit-app-region: no-drag;
  .ant-typography { font-size: 12px; }
`
const Fields = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  .ant-select { flex: 1 1 140px; min-width: 0; }
`
