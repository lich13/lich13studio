import { invoke } from '@tauri-apps/api/core'

export interface BackupOptions {
  includeCredentials?: boolean
  password?: string
}

export async function exportPortableBackup(fileName: string, skipBackupFile: boolean, options: BackupOptions = {}) {
  if (options.includeCredentials && !options.password) throw new Error('Backup password is required')
  const { buildBackupSnapshot } = await import('@renderer/tauri-shim')
  const state = await buildBackupSnapshot(Boolean(options.includeCredentials))
  const targetFileName = options.includeCredentials ? fileName.replace(/\.(zip|bak)$/i, '') + '.lich13backup' : fileName
  try {
    const savedPath = await invoke<string>('export_portable_backup_archive', {
      fileName: targetFileName,
      state,
      includeFiles: !skipBackupFile,
      password: options.includeCredentials ? options.password : null
    })
    return typeof savedPath === 'string' ? savedPath.trim() : ''
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return ''
    }
    throw error
  }
}

export async function decryptPortableBackup(bytes: number[]) {
  const { requestBackupPassword } = await import('@renderer/components/Popups/BackupPasswordPopup')
  const password = await requestBackupPassword()
  if (password === null) return null
  return invoke<string | number[]>('restore_encrypted_backup_archive', { bytes, password })
}
