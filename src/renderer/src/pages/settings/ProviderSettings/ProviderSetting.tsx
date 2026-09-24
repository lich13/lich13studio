import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProvider'
import { formatApiKeys } from '@renderer/utils/api'
import { inferProviderPlatform, PLATFORM_NAMES, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import { normalizeProviderEndpoint, providerRequestBase } from '@shared/providerImport'
import { Button, Input, Select, Space, Switch } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingHelpText, SettingSubtitle, SettingTitle } from '..'
import ApiOptionsSettingsPopup from './ApiOptionsSettings/ApiOptionsSettingsPopup'
import CustomHeaderPopup from './CustomHeaderPopup'

export default function ProviderSetting({ providerId }: { providerId: string; isOnboarding?: boolean }) {
  const { provider, updateProvider } = useProvider(providerId)
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [host, setHost] = useState(provider.apiHost)
  const [key, setKey] = useState(provider.apiKey)
  const [hostInvalid, setHostInvalid] = useState(false)
  const platform = inferProviderPlatform(provider)
  useEffect(() => {
    setHost(provider.apiHost)
    setHostInvalid(false)
  }, [provider.apiHost])
  useEffect(() => setKey(provider.apiKey), [provider.apiKey])
  const saveHost = () => {
    try {
      const apiHost = normalizeProviderEndpoint(host)
      updateProvider({ apiHost })
      setHost(apiHost)
      setHostInvalid(false)
    } catch {
      setHostInvalid(true)
      window.toast.error(t('platform.invalid_address'))
    }
  }
  let preview = ''
  try {
    preview = host
      ? host.trim().endsWith('#')
        ? providerRequestBase(host)
        : `${providerRequestBase(host)}/${provider.type === 'anthropic' ? 'messages' : 'responses'}`
      : ''
  } catch {
    /* Preview is empty until the address is valid. */
  }
  return (
    <SettingContainer theme={theme}>
      <SettingTitle style={{ display: 'flex', justifyContent: 'space-between' }}>
        {provider.name}
        <Switch checked={provider.enabled} onChange={(enabled) => updateProvider({ enabled })} />
      </SettingTitle>
      <SettingSubtitle>{t('platform.label')}</SettingSubtitle>
      <Select
        value={platform}
        style={{ width: '100%' }}
        onChange={(platform: ProviderPlatform) => updateProvider({ platform })}
        options={PROVIDER_PLATFORMS.map((value) => ({ value, label: PLATFORM_NAMES[value] }))}
      />
      <SettingHelpText>
        {t('platform.provider_help', {
          platform: PLATFORM_NAMES[platform],
          protocol: provider.type === 'anthropic' ? 'Anthropic' : 'Responses'
        })}
      </SettingHelpText>
      <SettingSubtitle>API Key</SettingSubtitle>
      <Space.Compact style={{ width: '100%' }}>
        <Input.Password
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setKey(event.target.value)}
          onBlur={() => updateProvider({ apiKey: formatApiKeys(key) })}
        />
        <Button onClick={() => ApiKeyListPopup.show({ providerId, providerType: 'llm' })}>
          {t('settings.provider.api.key.list.title')}
        </Button>
      </Space.Compact>
      <SettingSubtitle>{t('settings.provider.api_host')}</SettingSubtitle>
      <Input
        value={host}
        status={hostInvalid ? 'error' : undefined}
        onChange={(event) => setHost(event.target.value)}
        onBlur={saveHost}
        onPressEnter={saveHost}
        spellCheck={false}
      />
      <SettingHelpText style={{ overflowWrap: 'anywhere' }}>
        {t('settings.provider.api_host_preview', { url: preview })}
      </SettingHelpText>
      <Space style={{ marginTop: 18 }}>
        <Button onClick={() => CustomHeaderPopup.show({ provider })}>
          {t('settings.provider.copilot.custom_headers')}
        </Button>
        <Button onClick={() => ApiOptionsSettingsPopup.show({ providerId: provider.id })}>
          {t('platform.api_options')}
        </Button>
      </Space>
    </SettingContainer>
  )
}
