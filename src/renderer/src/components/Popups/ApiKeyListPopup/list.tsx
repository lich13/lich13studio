import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { useProvider } from '@renderer/hooks/useProvider'
import type { PreprocessProviderId } from '@renderer/types'
import { Button, List } from 'antd'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useApiKeys } from './hook'
import ApiKeyItem from './item'
import type { ApiProvider, UpdateApiProviderFunc } from './types'

export function ApiKeyList({
  provider,
  updateProvider
}: {
  provider: ApiProvider
  updateProvider: UpdateApiProviderFunc
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const { keys, addKey, updateKey, removeKey } = useApiKeys({ provider, updateProvider })
  return (
    <>
      <List style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {keys.map((key, index) => (
          <ApiKeyItem
            key={key}
            apiKey={key}
            onUpdate={(value) => updateKey(index, value)}
            onRemove={() => removeKey(index)}
          />
        ))}
        {adding && (
          <ApiKeyItem
            apiKey=""
            isNew
            onUpdate={(value) => {
              const result = addKey(value)
              if (result.isValid) setAdding(false)
              return result
            }}
            onRemove={() => setAdding(false)}
          />
        )}
      </List>
      <Button
        type="primary"
        icon={<Plus size={16} />}
        onClick={() => setAdding(true)}
        disabled={adding}
        style={{ marginTop: 12 }}>
        {t('common.add')}
      </Button>
    </>
  )
}
export function LlmApiKeyList({ providerId }: { providerId: string }) {
  const { provider, updateProvider } = useProvider(providerId)
  return <ApiKeyList provider={provider} updateProvider={updateProvider} />
}
export function DocPreprocessApiKeyList({ providerId }: { providerId: PreprocessProviderId }) {
  const { provider, updateProvider } = usePreprocessProvider(providerId)
  return <ApiKeyList provider={provider} updateProvider={updateProvider} />
}
