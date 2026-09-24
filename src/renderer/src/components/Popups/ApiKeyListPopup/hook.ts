import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ApiKeyValidity, ApiProvider, UpdateApiProviderFunc } from './types'

export function useApiKeys({
  provider,
  updateProvider
}: {
  provider: ApiProvider
  updateProvider: UpdateApiProviderFunc
}) {
  const { t } = useTranslation()
  const keys = useMemo(() => [...new Set(splitApiKeyString(formatApiKeys(provider.apiKey || '')))], [provider.apiKey])
  const save = (next: string[]) => updateProvider({ apiKey: formatApiKeys(next.join(',')) })
  const validate = (value: string, existing: string[]): ApiKeyValidity => {
    if (!value.trim()) return { isValid: false, error: t('settings.provider.api.key.error.empty') }
    if (existing.includes(value.trim()))
      return { isValid: false, error: t('settings.provider.api.key.error.duplicate') }
    return { isValid: true }
  }
  return {
    keys,
    addKey(value: string) {
      const result = validate(value, keys)
      if (result.isValid) save([...keys, value.trim()])
      return result
    },
    updateKey(index: number, value: string) {
      const result = validate(
        value,
        keys.filter((_, i) => i !== index)
      )
      if (result.isValid) save(keys.map((key, i) => (i === index ? value.trim() : key)))
      return result
    },
    removeKey(index: number) {
      save(keys.filter((_, i) => i !== index))
    }
  }
}
