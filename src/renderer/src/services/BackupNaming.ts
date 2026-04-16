import dayjs from 'dayjs'

export const BACKUP_FILE_EXTENSION = '.zip'
export const BACKUP_FILE_PREFIX = 'lich13studio'
const BACKUP_FILE_REGEX = new RegExp(
  `^${BACKUP_FILE_PREFIX}\\.(\\d{14})\\.([a-z0-9-]+)\\.([a-z0-9-]+)\\${BACKUP_FILE_EXTENSION}$`,
  'i'
)

export function ensureBackupFileName(fileName: string, fallbackName?: string) {
  const candidate = (fileName || fallbackName || `${BACKUP_FILE_PREFIX}${BACKUP_FILE_EXTENSION}`).trim()
  if (!candidate) {
    return `${BACKUP_FILE_PREFIX}${BACKUP_FILE_EXTENSION}`
  }

  return candidate.toLowerCase().endsWith(BACKUP_FILE_EXTENSION) ? candidate : `${candidate}${BACKUP_FILE_EXTENSION}`
}

export function normalizeBackupDevicePart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'unknown'
}

export function buildDefaultBackupFileName(deviceName: string, systemType: string) {
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  return ensureBackupFileName(
    `${BACKUP_FILE_PREFIX}.${timestamp}.${normalizeBackupDevicePart(deviceName)}.${normalizeBackupDevicePart(systemType)}`
  )
}

export function parseBackupFileName(fileName: string) {
  const normalized = ensureBackupFileName(fileName)
  const match = normalized.match(BACKUP_FILE_REGEX)

  if (!match) {
    return null
  }

  return {
    timestamp: match[1],
    deviceName: match[2],
    systemType: match[3]
  }
}

export function isBackupOwnedByDevice(fileName: string, deviceName: string, systemType: string) {
  const parsed = parseBackupFileName(fileName)
  if (!parsed) {
    return false
  }

  return (
    parsed.deviceName === normalizeBackupDevicePart(deviceName) &&
    parsed.systemType === normalizeBackupDevicePart(systemType)
  )
}
