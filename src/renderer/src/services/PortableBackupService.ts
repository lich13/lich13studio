import { invoke } from '@tauri-apps/api/core'

export interface BackupOptions {
  includeCredentials?: boolean
  password?: string
}
export async function exportPortableBackup(fileName: string, skipBackupFile: boolean, options: BackupOptions = {}) {
  if (options.includeCredentials && !options.password) throw new Error('Backup password is required')
  const { buildBackupSnapshot } = await import('@renderer/tauri-shim')
  const state = await buildBackupSnapshot(Boolean(options.includeCredentials))
  let bytes = await invoke<number[]>('create_portable_backup', { state, includeFiles: !skipBackupFile })
  if (options.includeCredentials) {
    bytes = await invoke<number[]>('encrypt_backup', { bytes, password: options.password })
    fileName = fileName.replace(/\.(zip|bak)$/i, '') + '.lich13backup'
  }
  return invoke<string>('save_file', { fileName, bytes })
}
export async function decryptPortableBackup(bytes: number[]) {
  const { requestBackupPassword } = await import('@renderer/components/Popups/BackupPasswordPopup')
  const password = await requestBackupPassword()
  if (password === null) return null
  return invoke<number[]>('decrypt_backup', { bytes, password })
}
