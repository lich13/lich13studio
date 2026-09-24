import { useTheme } from '@renderer/context/ThemeProvider'
import { getPlatformHeaders, syncCliVersion } from '@renderer/services/CliVersionService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setPlatformModels } from '@renderer/store/llm'
import type { Model, Provider } from '@renderer/types'
import { effectiveCliVersion } from '@shared/cliIdentity'
import {
  catalogModel,
  PLATFORM_NAMES,
  type PlatformModel,
  platformProtocol,
  type ProviderPlatform
} from '@shared/platforms'
import { Button, Empty, Flex, Input, List, Modal, Popconfirm, Space, Typography } from 'antd'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingHelpText, SettingSubtitle, SettingTitle } from '..'
import ModelEditContent from './EditModelPopup/ModelEditContent'

export default function PlatformSettings({ platform }: { platform: ProviderPlatform }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const models = useAppSelector((state) => state.llm.platformModels[platform])
  const cache = useAppSelector((state) => state.llm.cliVersions[platform])
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [id, setId] = useState('')
  const [editing, setEditing] = useState<PlatformModel>()
  const setModels = (models: PlatformModel[]) => dispatch(setPlatformModels({ platform, models }))
  const move = (index: number, offset: number) => {
    const updated = [...models]
    const [model] = updated.splice(index, 1)
    updated.splice(index + offset, 0, model)
    setModels(updated)
  }
  const add = () => {
    const modelId = id.trim()
    if (!modelId) return
    if (models.some((model) => model.id === modelId)) {
      window.toast.error(t('error.model.exists'))
      return
    }
    setModels([...models, { id: modelId, name: modelId, group: PLATFORM_NAMES[platform] }])
    setAdding(false)
    setId('')
  }
  const update = (model: Model) => {
    if (!editing) return
    if (model.id !== editing.id && models.some((entry) => entry.id === model.id)) {
      window.toast.error(t('error.model.exists'))
      return
    }
    setModels(models.map((entry) => (entry.id === editing.id ? catalogModel(model) : entry)))
    setEditing(catalogModel(model))
  }
  const editorProvider: Provider = {
    id: `platform:${platform}`,
    platform,
    type: platformProtocol(platform),
    name: PLATFORM_NAMES[platform],
    apiHost: '',
    apiKey: '',
    models: []
  }
  return (
    <SettingContainer theme={theme}>
      <SettingTitle>
        {PLATFORM_NAMES[platform]} · {t('platform.models_title')}
      </SettingTitle>
      <SettingHelpText>{t('platform.models_help')}</SettingHelpText>
      <SettingSubtitle>{t('platform.cli_identity')}</SettingSubtitle>
      <Typography.Text code style={{ overflowWrap: 'anywhere' }}>
        {getPlatformHeaders(platform, cache?.version)['User-Agent']}
      </Typography.Text>
      <Flex justify="space-between" align="center" style={{ margin: '12px 0 22px' }}>
        <SettingHelpText>
          {effectiveCliVersion(platform, cache?.version)} ·{' '}
          {cache?.syncedAt ? new Date(cache.syncedAt).toLocaleString() : t('platform.builtin_version')}
        </SettingHelpText>
        <Button
          loading={syncing}
          onClick={async () => {
            setSyncing(true)
            try {
              await syncCliVersion(platform, true)
            } finally {
              setSyncing(false)
            }
          }}>
          {t('platform.sync_now')}
        </Button>
      </Flex>
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input.Search
          placeholder={t('platform.search_models')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
        <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>
          {t('common.add')}
        </Button>
      </Space.Compact>
      <List<PlatformModel>
        locale={{ emptyText: <Empty description={t('settings.models.empty')} /> }}
        dataSource={models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase()))}
        renderItem={(model) => {
          const index = models.findIndex((entry) => entry.id === model.id)
          return (
            <List.Item
              actions={[
                <Button
                  key="up"
                  type="text"
                  aria-label={t('platform.move_up')}
                  icon={<ArrowUp size={16} />}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />,
                <Button
                  key="down"
                  type="text"
                  aria-label={t('platform.move_down')}
                  icon={<ArrowDown size={16} />}
                  disabled={index === models.length - 1}
                  onClick={() => move(index, 1)}
                />,
                <Button
                  key="edit"
                  type="text"
                  aria-label={t('common.edit')}
                  icon={<Pencil size={16} />}
                  onClick={() => setEditing(model)}
                />,
                <Popconfirm
                  key="delete"
                  title={t('platform.delete_model')}
                  onConfirm={() => setModels(models.filter((entry) => entry.id !== model.id))}>
                  <Button type="text" danger aria-label={t('common.delete')} icon={<Trash2 size={16} />} />
                </Popconfirm>
              ]}>
              <List.Item.Meta title={model.name} description={model.id} />
            </List.Item>
          )
        }}
      />
      <Modal
        open={adding}
        title={t('settings.models.add.model_id.label')}
        onOk={add}
        onCancel={() => setAdding(false)}
        destroyOnHidden>
        <Input
          value={id}
          onChange={(event) => setId(event.target.value)}
          onPressEnter={add}
          placeholder="model-id"
          autoFocus
        />
      </Modal>
      {editing && (
        <ModelEditContent
          key={editing.id}
          provider={editorProvider}
          model={{ ...editing, provider: editorProvider.id }}
          onUpdateModel={update}
          open
          onCancel={() => setEditing(undefined)}
          onOk={() => setEditing(undefined)}
        />
      )}
    </SettingContainer>
  )
}
