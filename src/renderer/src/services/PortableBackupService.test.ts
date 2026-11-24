import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  requestPassword: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@renderer/tauri-shim', () => ({
  buildBackupSnapshot: vi.fn(async (includeCredentials: boolean) => ({
    version: 5,
    includeCredentials,
    localStorage: { 'persist:cherry-studio': '{}' },
    indexedDB: {}
  }))
}))
vi.mock('@renderer/components/Popups/BackupPasswordPopup', () => ({
  requestBackupPassword: mocks.requestPassword
}))

import { decryptPortableBackup, exportPortableBackup } from './PortableBackupService'

describe('decryptPortableBackup', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.requestPassword.mockReset().mockResolvedValue(null)
  })

  it('does not invoke decryption when the password dialog is cancelled', async () => {
    await expect(decryptPortableBackup([1, 2, 3])).resolves.toBeNull()

    expect(mocks.requestPassword).toHaveBeenCalledOnce()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('exports encrypted portable backups via single one-shot native command', async () => {
    mocks.invoke.mockResolvedValueOnce('/tmp/lich13studio.lich13backup')

    const saved = await exportPortableBackup('lich13studio.20261125.zip', false, {
      includeCredentials: true,
      password: 'fixture-password'
    })

    expect(saved).toBe('/tmp/lich13studio.lich13backup')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('export_portable_backup_archive', {
      fileName: 'lich13studio.20261125.lich13backup',
      state: expect.objectContaining({ version: 5, includeCredentials: true }),
      includeFiles: true,
      password: 'fixture-password'
    })
  })

  it('returns empty string without throwing when the native save dialog is cancelled', async () => {
    mocks.invoke.mockResolvedValueOnce('')
    await expect(exportPortableBackup('lich13studio.20261125.zip', true)).resolves.toBe('')

    mocks.invoke.mockRejectedValueOnce(new Error('User canceled the save dialog'))
    await expect(exportPortableBackup('lich13studio.20261125.zip', true)).resolves.toBe('')
  })
})
