import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  requestPassword: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@renderer/components/Popups/BackupPasswordPopup', () => ({
  requestBackupPassword: mocks.requestPassword
}))

import { decryptPortableBackup } from './PortableBackupService'

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
})
