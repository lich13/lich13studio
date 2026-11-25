import { TopView } from '@renderer/components/TopView'
import { submitProviderImportText } from '@renderer/services/ProviderImportQueue'
import { PLATFORM_NAMES, platformProtocol, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import type { ProviderImport } from '@shared/providerImport'
import { Descriptions, Input, Modal, Select, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

function ImportDialog({ incoming, resolve }: { incoming: ProviderImport; resolve: (result?: ProviderImport) => void }) {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<ProviderPlatform>(incoming.platform)
  const [name, setName] = useState(incoming.name)
  const masked =
    incoming.apiKey.length > 8 ? `${incoming.apiKey.slice(0, 3)}••••${incoming.apiKey.slice(-3)}` : '••••••••'

  return (
    <Modal
      title={t('platform.import_title')}
      open
      centered
      onCancel={() => resolve()}
      onOk={() =>
        resolve({ ...incoming, name: name.trim() || incoming.name, platform, type: platformProtocol(platform) })
      }
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}>
      <Descriptions column={1} bordered size="small" style={{ marginTop: 18 }}>
        <Descriptions.Item label={t('settings.models.provider_name')}>
          <Input name="importProviderName" value={name} onChange={(event) => setName(event.target.value)} />
        </Descriptions.Item>
        <Descriptions.Item label={t('platform.label')}>
          <Select
            style={{ width: '100%' }}
            value={platform}
            onChange={(value: ProviderPlatform) => setPlatform(value)}
            options={PROVIDER_PLATFORMS.map((value) => ({ value, label: PLATFORM_NAMES[value] }))}
          />
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.models.base_url')}>{incoming.apiHost}</Descriptions.Item>
        <Descriptions.Item label={t('settings.provider.api_key.label')}>{masked}</Descriptions.Item>
        <Descriptions.Item label={t('platform.models_title')}>
          {incoming.models.length ? incoming.models.map((id) => <Tag key={id}>{id}</Tag>) : t('platform.use_catalog')}
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  )
}

function PasteLinkDialog({ resolve }: { resolve: (rawLink?: string) => void }) {
  const { t } = useTranslation()
  const [rawLink, setRawLink] = useState('')
  const submit = () => {
    const trimmed = rawLink.trim()
    if (!trimmed) return
    setRawLink('')
    resolve(trimmed)
  }

  return (
    <Modal
      title={t('settings.provider.import_link')}
      open
      centered
      onCancel={() => {
        setRawLink('')
        resolve()
      }}
      onOk={submit}
      okButtonProps={{ disabled: !rawLink.trim() }}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}>
      <Input.Password
        name="ccswitchImportLink"
        autoComplete="off"
        autoFocus
        value={rawLink}
        placeholder={t('settings.provider.import_link_placeholder')}
        aria-label={t('settings.provider.import_link')}
        onChange={(event) => setRawLink(event.target.value)}
        onPressEnter={submit}
      />
    </Modal>
  )
}

let importSequence = 0

export async function promptManualProviderImport(): Promise<void> {
  const rawLink = await ProviderImportPopup.promptLink()
  if (rawLink) {
    submitProviderImportText(rawLink)
  }
}

export default class ProviderImportPopup {
  static show(incoming: ProviderImport): Promise<ProviderImport | undefined> {
    const viewId = `CCSImport-${++importSequence}`
    return new Promise((resolve) => {
      const finish = (result?: ProviderImport) => {
        TopView.hide(viewId)
        resolve(result)
      }
      TopView.show(<ImportDialog incoming={incoming} resolve={finish} />, viewId, () => finish())
    })
  }

  static promptLink(): Promise<string | undefined> {
    const viewId = `CCSImportPaste-${++importSequence}`
    return new Promise((resolve) => {
      const finish = (rawLink?: string) => {
        TopView.hide(viewId)
        resolve(rawLink)
      }
      TopView.show(<PasteLinkDialog resolve={finish} />, viewId, () => finish())
    })
  }
}
