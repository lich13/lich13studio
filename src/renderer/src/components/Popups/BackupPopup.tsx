import { loggerService } from '@logger'
import { getBackupProgressLabel } from '@renderer/i18n/label'
import { backup } from '@renderer/services/BackupService'
import store from '@renderer/store'
import { Alert, Checkbox, Input, Modal, Progress, Space } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('BackupPopup')

interface Props {
  resolve: (data: any) => void
}

interface ProgressData {
  stage: string
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [includeCredentials, setIncludeCredentials] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  const [progressData, setProgressData] = useState<ProgressData>()
  const { t } = useTranslation()
  const skipBackupFile = store.getState().settings.skipBackupFile

  useEffect(() => {
    const removeListener = window.api.backup.onProgress((data: ProgressData) => {
      setProgressData(data)
    })

    return removeListener
  }, [])

  const onOk = async () => {
    logger.debug(`skipBackupFile: ${skipBackupFile}`)
    setBusy(true)
    setError('')
    try {
      await backup(skipBackupFile, { includeCredentials, password })
      setPassword('')
      setOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setProgressData(undefined)
    } finally {
      setBusy(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('backup.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return getBackupProgressLabel(progressData.stage)
  }

  BackupPopup.hide = onCancel

  const isDisabled = busy || (includeCredentials && !password)
  return (
    <Modal
      title={t('backup.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okButtonProps={{ disabled: isDisabled }}
      cancelButtonProps={{ disabled: busy }}
      okText={t('backup.confirm.button')}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!progressData && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Checkbox checked={includeCredentials} onChange={(event) => setIncludeCredentials(event.target.checked)}>
            {t('backup.includeCredentials')}
          </Checkbox>
          {includeCredentials && (
            <Input.Password
              autoComplete="new-password"
              aria-label={t('backup.password')}
              placeholder={t('backup.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
          {error && <Alert type="error" message={error} />}
        </Space>
      )}
      {progressData && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={Math.floor(progressData.progress)} strokeColor="var(--color-primary)" />
          <div style={{ marginTop: 16 }}>{getProgressText()}</div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'BackupPopup'

export default class BackupPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
