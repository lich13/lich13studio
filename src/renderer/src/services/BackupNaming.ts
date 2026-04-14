import dayjs from 'dayjs'

export const BACKUP_FILE_EXTENSION = '.zip'
export const BACKUP_FILE_PREFIX = 'lich13studio'

export function ensureBackupFileName(fileName: string, fallbackName?: string) {
  const candidate = (fileName || fallbackName || `${BACKUP_FILE_PREFIX}${BACKUP_FILE_EXTENSION}`).trim()
  if (!candidate) {
    return `${BACKUP_FILE_PREFIX}${BACKUP_FILE_EXTENSION}`
  }

  return candidate.toLowerCase().endsWith(BACKUP_FILE_EXTENSION) ? candidate : `${candidate}${BACKUP_FILE_EXTENSION}`
}

export function buildDefaultBackupFileName(hostname: string, deviceType: string) {
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  return ensureBackupFileName(`${BACKUP_FILE_PREFIX}.${timestamp}.${hostname}.${deviceType}`)
}
