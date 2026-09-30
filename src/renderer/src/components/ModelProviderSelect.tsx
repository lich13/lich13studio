import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { reasoningUsage } from '@renderer/services/ReasoningUsageService'
import { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'
import { getModelPresentation } from '@renderer/utils/modelPresentation'
import { type ModelProviderSelection, resolveModelProviderSelection } from '@shared/modelProviderSelection'
import { PLATFORM_NAMES, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import { Select, Tooltip, Typography } from 'antd'
import { CircleAlert } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelAvatar from './Avatar/ModelAvatar'
import ModelTagsWithLabel from './ModelTagsWithLabel'

export default function ModelProviderSelect({
  selection,
  onChange,
  compact = false,
  layout = 'responsive',
  filter,
  showEffort = false
}: {
  selection: ModelProviderSelection
  onChange: (selection: ModelProviderSelection) => void
  compact?: boolean
  layout?: 'inline' | 'responsive'
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
        label: getModelPresentation(model).label,
        searchText: getModelPresentation(model).searchText,
        model: { ...model, provider: '' } as Model | undefined,
        disabled: false
      }))
  }))
  if (selection.modelId && !resolved.definition)
    models.push({
      label: t('settings.modelTest.unavailable'),
      options: [
        {
          value: JSON.stringify([selection.platform, selection.modelId]),
          label: selection.modelId,
          model: undefined,
          disabled: true
        }
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
  const issue =
    resolved.model && (isEmbeddingModel(resolved.model) || isRerankModel(resolved.model))
      ? 'modelUnavailable'
      : resolved.issue
  const issueText = issue
    ? t(issue === 'modelUnavailable' ? 'settings.modelTest.modelUnavailable' : 'settings.modelTest.providerUnavailable')
    : undefined
  const effortText =
    effort && t('chat.effectiveReasoning', { requested: effort.requested, effective: effort.effective })
  return (
    <Controls className="model-provider-selection nodrag" $compact={compact} $inline={layout === 'inline'}>
      <Fields className="model-provider-fields" $inline={layout === 'inline'}>
        <Select
          aria-label={t('settings.modelTest.modelLabel')}
          title={selection.modelId}
          showSearch
          filterOption={(input, option) =>
            String((option as { searchText?: string })?.searchText || option?.label || '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          popupMatchSelectWidth={420}
          styles={{ popup: { root: { maxWidth: 'calc(100vw - 24px)' } } }}
          size={compact ? 'small' : 'middle'}
          options={models}
          optionRender={(option) => {
            const model = (option.data as { model?: Model }).model
            return (
              <ModelOption className="model-option">
                <ModelAvatar model={model} size={24} />
                <span className="model-name" title={model?.id || String(option.label)}>
                  {model ? (
                    <>
                      <span>{getModelPresentation(model).primary}</span>
                      {getModelPresentation(model).secondary && (
                        <small style={{ display: 'block', color: 'var(--color-text-3)' }}>{model.id}</small>
                      )}
                    </>
                  ) : (
                    option.label
                  )}
                </span>
                {model && <ModelTagsWithLabel model={model} showLabel={false} showFree={false} />}
              </ModelOption>
            )
          }}
          value={selection.modelId ? JSON.stringify([selection.platform, selection.modelId]) : undefined}
          placeholder={t('button.select_model')}
          onChange={(value: string) => {
            const [platform, modelId] = JSON.parse(value) as [ProviderPlatform, string]
            onChange({ ...selection, platform, modelId })
          }}
        />
        <Select
          aria-label={t('settings.modelTest.providerLabel')}
          title={providers.find((provider) => provider.value === selection.providerId)?.label}
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
        <Tooltip title={effortText}>
          <Typography.Text type="secondary" aria-label={effortText} className="selection-status">
            {layout === 'inline' ? effort.effective : effortText}
          </Typography.Text>
        </Tooltip>
      )}
      {issueText && (
        <Tooltip title={issueText}>
          <Typography.Text type="warning" role="status" aria-label={issueText} className="selection-status">
            {layout === 'inline' ? <CircleAlert size={14} aria-hidden /> : issueText}
          </Typography.Text>
        </Tooltip>
      )}
    </Controls>
  )
}

const ModelOption = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  .model-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  > :last-child { flex-shrink: 0; }
`

const Controls = styled.div<{ $compact: boolean; $inline: boolean }>`
  display: flex;
  flex-direction: ${({ $inline }) => ($inline ? 'row' : 'column')};
  align-items: ${({ $inline }) => ($inline ? 'center' : 'stretch')};
  flex: ${({ $inline }) => ($inline ? '0 0 auto' : '0 1 auto')};
  gap: 6px;
  min-width: 0;
  width: ${({ $compact, $inline }) => ($inline ? 'auto' : $compact ? 'min(380px, 100%)' : '100%')};
  -webkit-app-region: no-drag;
  .ant-typography { font-size: 12px; }
  .selection-status { display: inline-flex; align-items: center; flex-shrink: 0; }
`
const Fields = styled.div<{ $inline: boolean }>`
  display: flex;
  align-items: center;
  flex-wrap: ${({ $inline }) => ($inline ? 'nowrap' : 'wrap')};
  min-width: 0;
  gap: 6px;
  .ant-select {
    flex: ${({ $inline }) => ($inline ? '0 0 auto' : '1 1 140px')};
    min-width: 0;
    width: ${({ $inline }) => ($inline ? 'clamp(140px, 15vw, 220px)' : 'auto')};
  }
  .ant-select + .ant-select {
    width: ${({ $inline }) => ($inline ? 'clamp(120px, 12vw, 170px)' : 'auto')};
  }
`
