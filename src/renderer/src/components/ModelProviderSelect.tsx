import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import { reasoningUsage } from '@renderer/services/ReasoningUsageService'
import { useAppSelector } from '@renderer/store'
import type { Model } from '@renderer/types'
import { getModelPresentation } from '@renderer/utils/modelPresentation'
import { type ModelProviderSelection, resolveModelProviderSelection } from '@shared/modelProviderSelection'
import { PLATFORM_NAMES, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import { Select, Tooltip, Typography } from 'antd'
import { CircleAlert } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelAvatar from './Avatar/ModelAvatar'
import ModelTagsWithLabel from './ModelTagsWithLabel'

export function parseModelProviderSelectionValue(value: unknown): [ProviderPlatform, string] | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [platform, modelId] = parsed
    if (
      typeof platform !== 'string' ||
      !(PROVIDER_PLATFORMS as readonly string[]).includes(platform) ||
      typeof modelId !== 'string' ||
      !modelId.trim()
    )
      return null
    return [platform as ProviderPlatform, modelId]
  } catch {
    return null
  }
}

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
  const [draftSelection, setDraftSelection] = useState(selection)
  const [openField, setOpenField] = useState<'model' | 'provider' | null>(null)
  useEffect(() => {
    if (!openField) setDraftSelection(selection)
  }, [selection, openField])
  const activeSelection = openField ? draftSelection : selection
  const resolved = resolveModelProviderSelection(activeSelection, llm)
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
  if (activeSelection.modelId && !resolved.definition)
    models.push({
      label: t('settings.modelTest.unavailable'),
      options: [
        {
          value: JSON.stringify([activeSelection.platform, activeSelection.modelId]),
          label: activeSelection.modelId,
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
  if (activeSelection.providerId && !resolved.provider)
    providers.push({
      value: activeSelection.providerId,
      label: `${llm.providers.find((provider) => provider.id === activeSelection.providerId)?.name || activeSelection.providerId} (${t('settings.modelTest.unavailable')})`,
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
  const handleModelChange = (value: unknown) => {
    const parsed = parseModelProviderSelectionValue(value)
    if (!parsed || !models.some((group) => group.options.some((option) => option.value === value && !option.disabled)))
      return
    const [platform, modelId] = parsed
    const next = { ...activeSelection, platform, modelId }
    setDraftSelection(next)
    onChange(next)
  }
  const handleProviderChange = (providerId: unknown) => {
    if (
      typeof providerId !== 'string' ||
      !providers.some((provider) => provider.value === providerId && !provider.disabled)
    )
      return
    const next = { ...activeSelection, providerId }
    setDraftSelection(next)
    onChange(next)
  }
  return (
    <Controls className="model-provider-selection nodrag" $compact={compact} $inline={layout === 'inline'}>
      {runtimeCapabilities.android ? (
        <NativeFields className="model-provider-fields">
          <NativeSelect
            aria-label={t('settings.modelTest.modelLabel')}
            title={activeSelection.modelId}
            value={activeSelection.modelId ? JSON.stringify([activeSelection.platform, activeSelection.modelId]) : ''}
            onChange={(event) => handleModelChange(event.currentTarget.value)}>
            <option value="" disabled>
              {t('button.select_model')}
            </option>
            {models.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('settings.modelTest.providerLabel')}
            title={providers.find((provider) => provider.value === activeSelection.providerId)?.label}
            value={activeSelection.providerId || ''}
            disabled={!activeSelection.modelId}
            onChange={(event) => handleProviderChange(event.currentTarget.value)}>
            <option value="" disabled>
              {t('settings.modelTest.providerPlaceholder')}
            </option>
            {providers.map((provider) => (
              <option key={provider.value} value={provider.value} disabled={provider.disabled}>
                {provider.label}
              </option>
            ))}
          </NativeSelect>
        </NativeFields>
      ) : (
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
            getPopupContainer={() => document.body}
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
            value={
              activeSelection.modelId ? JSON.stringify([activeSelection.platform, activeSelection.modelId]) : undefined
            }
            placeholder={t('button.select_model')}
            open={openField === 'model'}
            onOpenChange={(open) => setOpenField((field) => (open ? 'model' : field === 'model' ? null : field))}
            onChange={handleModelChange}
          />
          <Select
            aria-label={t('settings.modelTest.providerLabel')}
            title={providers.find((provider) => provider.value === selection.providerId)?.label}
            showSearch
            optionFilterProp="label"
            size={compact ? 'small' : 'middle'}
            options={providers}
            value={activeSelection.providerId}
            placeholder={t('settings.modelTest.providerPlaceholder')}
            disabled={!activeSelection.modelId}
            getPopupContainer={() => document.body}
            open={openField === 'provider'}
            onOpenChange={(open) => setOpenField((field) => (open ? 'provider' : field === 'provider' ? null : field))}
            onChange={handleProviderChange}
          />
        </Fields>
      )}
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

const NativeFields = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
  width: 100%;
`
const NativeSelect = styled.select`
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  background: var(--color-background);
  font: inherit;
  font-size: 16px;
`
