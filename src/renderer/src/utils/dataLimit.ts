import { loggerService } from '@logger'
import { MB } from '@shared/config/constant'
import { notification } from 'antd'
import { t } from 'i18next'

const logger = loggerService.withContext('useDataLimit')

let diskWarningNotificationKey: string | null = null

async function checkAppStorageQuota() {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage && quota) {
      const usageInMB = (usage / MB).toFixed(2)
      const quotaInMB = (quota / MB).toFixed(2)
      const usagePercentage = (usage / quota) * 100

      logger.info(`App storage quota: Used ${usageInMB} MB / Total ${quotaInMB} MB (${usagePercentage.toFixed(2)}%)`)

      if (usagePercentage >= 95) {
        return true
      }
    }
  } catch (error) {
    logger.error('Failed to get storage quota:', error as Error)
  }
  return false
}

export async function checkDataLimit() {
  const isStorageQuotaLow = await checkAppStorageQuota()
  if (isStorageQuotaLow && !diskWarningNotificationKey) {
    const key = `disk-warning-${Date.now()}`
    notification.warning({
      message: t('settings.data.limit.appDataDiskQuota'),
      description: t('settings.data.limit.appDataDiskQuotaDescription'),
      duration: 0,
      key
    })
    diskWarningNotificationKey = key
  } else if (!isStorageQuotaLow && diskWarningNotificationKey) {
    notification.destroy(diskWarningNotificationKey)
    diskWarningNotificationKey = null
  }
}
