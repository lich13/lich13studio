import { loggerService } from '@logger'
import { buildDefaultBackupFileName } from '@renderer/services/BackupNaming'
import { backupToLocal } from '@renderer/services/BackupService'
import { Button, Input, Modal } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LocalBackupModalProps {
  isModalVisible: boolean
  handleBackup: () => void
  handleCancel: () => void
  backuping: boolean
  customFileName: string
  setCustomFileName: (value: string) => void
}

const logger = loggerService.withContext('LocalBackupModal')

export function LocalBackupModal({
  isModalVisible,
  handleBackup,
  handleCancel,
  backuping,
  customFileName,
  setCustomFileName
}: LocalBackupModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('settings.data.local.backup.modal.title')}
      open={isModalVisible}
      onOk={handleBackup}
      onCancel={handleCancel}
      footer={[
        <Button key="back" onClick={handleCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={backuping} onClick={handleBackup}>
          {t('common.confirm')}
        </Button>
      ]}>
      <Input
        value={customFileName}
        onChange={(e) => setCustomFileName(e.target.value)}
        placeholder={t('settings.data.local.backup.modal.filename.placeholder')}
      />
    </Modal>
  )
}

// Hook for backup modal
export function useLocalBackupModal(localBackupDir: string | undefined) {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [backuping, setBackuping] = useState(false)
  const [customFileName, setCustomFileName] = useState('')

  const handleCancel = () => {
    setIsModalVisible(false)
  }

  const showBackupModal = useCallback(async () => {
    const systemType = await window.api.system.getDeviceType()
    const deviceName = await window.api.system.getHostname()
    const defaultFileName = buildDefaultBackupFileName(deviceName, systemType)
    setCustomFileName(defaultFileName)
    setIsModalVisible(true)
  }, [])

  const handleBackup = async () => {
    if (!localBackupDir) {
      setIsModalVisible(false)
      return
    }

    setBackuping(true)
    try {
      await backupToLocal({
        showMessage: true,
        customFileName: customFileName || undefined
      })
      setIsModalVisible(false)
    } catch (error) {
      logger.error('Backup failed:', error as Error)
    } finally {
      setBackuping(false)
    }
  }

  return {
    isModalVisible,
    handleBackup,
    handleCancel,
    backuping,
    customFileName,
    setCustomFileName,
    showBackupModal
  }
}
