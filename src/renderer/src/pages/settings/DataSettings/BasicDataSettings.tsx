import { HStack } from '@renderer/components/Layout'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { reset } from '@renderer/services/BackupService'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import store, { useAppDispatch } from '@renderer/store'
import { setSkipBackupFile as _setSkipBackupFile } from '@renderer/store/settings'
import type { AppInfo } from '@renderer/types'
import { Button, Switch, Typography } from 'antd'
import { FolderOpen, SaveIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicDataSettings: React.FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheSize, setCacheSize] = useState<string>('')
  const { theme } = useTheme()

  const _skipBackupFile = store.getState().settings.skipBackupFile
  const [skipBackupFile, setSkipBackupFile] = useState<boolean>(_skipBackupFile)

  const dispatch = useAppDispatch()

  useEffect(() => {
    void window.api.getAppInfo().then(setAppInfo)
    void window.api.getCacheSize().then(setCacheSize)
  }, [])

  const handleOpenPath = (path?: string) => {
    if (!path) return
    void window.api.openPath(path)
  }

  const handleClearCache = () => {
    window.modal.confirm({
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.confirm'),
      okText: t('settings.data.clear_cache.button'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        try {
          await window.api.clearCache()
          await window.api.getCacheSize().then(setCacheSize)
          window.toast.success(t('settings.data.clear_cache.success'))
        } catch {
          window.toast.error(t('settings.data.clear_cache.error'))
        }
      }
    })
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setSkipBackupFile(value)
    dispatch(_setSkipBackupFile(value))
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
          <HStack gap="5px" justifyContent="space-between">
            <Button onClick={() => BackupPopup.show()} icon={<SaveIcon size={14} />}>
              {t('settings.general.backup.button')}
            </Button>
            <Button onClick={RestorePopup.show} icon={<FolderOpen size={14} />}>
              {t('settings.general.restore.button')}
            </Button>
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
          <Switch checked={skipBackupFile} onChange={onSkipBackupFilesChange} />
        </SettingRow>
        <SettingRow>
          <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.data.data.title')}</SettingTitle>
        {!runtimeCapabilities.android && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.data.app_data.label')}</SettingRowTitle>
              <PathRow>
                <PathText style={{ color: 'var(--color-text-3)' }} onClick={() => handleOpenPath(appInfo?.appDataPath)}>
                  {appInfo?.appDataPath}
                </PathText>
                <HStack gap="5px" style={{ marginLeft: '8px' }}>
                  <Button onClick={() => handleOpenPath(appInfo?.appDataPath)}>
                    {t('settings.data.app_data.open')}
                  </Button>
                </HStack>
              </PathRow>
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            {t('settings.data.clear_cache.title')}
            {cacheSize && <CacheText>({cacheSize})</CacheText>}
          </SettingRowTitle>
          <HStack gap="5px">
            <Button onClick={handleClearCache}>{t('settings.data.clear_cache.button')}</Button>
          </HStack>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.reset.title')}</SettingRowTitle>
          <HStack gap="5px">
            <Button onClick={reset} danger>
              {t('settings.general.reset.title')}
            </Button>
          </HStack>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

const CacheText = styled(Typography.Text)`
  color: var(--color-text-3);
  font-size: 12px;
  margin-left: 5px;
  line-height: 16px;
  display: inline-block;
  vertical-align: middle;
  text-align: left;
`

const PathText = styled(Typography.Text)`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
  text-align: right;
  margin-left: 5px;
  cursor: pointer;
`

const PathRow = styled(HStack)`
  min-width: 0;
  flex: 1;
  width: 0;
  align-items: center;
  gap: 5px;
`

export default BasicDataSettings
