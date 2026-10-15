// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  decryptPortableBackup: vi.fn()
}))

vi.mock('./services/mobile/webviewCompatibility', () => ({}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() })
  }
}))
vi.mock('@renderer/hooks/settingsSync', () => ({ isMainProcessSettingKey: () => false }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  onAction: vi.fn(async () => () => undefined),
  requestPermission: vi.fn(async () => 'denied')
}))
vi.mock('./services/mobile/credentials', () => ({
  hydrateCredentials: (value: unknown) => value,
  mobilePersistStorage: { removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn() },
  stripCredentials: (value: unknown) => value
}))
vi.mock('./services/mobile/runtime', () => ({
  mobileCommand: vi.fn(),
  runtimeCapabilities: { android: false }
}))
vi.mock('./services/ProviderImportQueue', () => ({ startProviderImportListener: vi.fn() }))
vi.mock('./utils/attachmentMime', () => ({
  attachmentMime: (_name: string, mime: string) => mime || 'application/octet-stream',
  managedAttachmentId: () => undefined
}))
vi.mock('./services/PortableBackupService', () => ({ decryptPortableBackup: mocks.decryptPortableBackup }))

describe('Tauri portable backup restore', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.decryptPortableBackup.mockReset().mockRejectedValue(new Error('fixture authentication failed'))
    localStorage.clear()
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings: JSON.stringify({ theme: 'dark' }) }))
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: { core: { invoke: mocks.invoke } }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal(
      'Blob',
      class {
        private readonly bytes: Uint8Array
        readonly size: number
        readonly type: string

        constructor(parts: ArrayBuffer[], options?: { type?: string }) {
          this.bytes = new Uint8Array(parts[0])
          this.size = this.bytes.byteLength
          this.type = options?.type || ''
        }

        async arrayBuffer() {
          return this.bytes.slice().buffer
        }
      }
    )
    vi.stubGlobal('indexedDB', { open: vi.fn() })
    await import('./tauri-shim')
  })

  afterEach(() => {
    delete (window as any).api
    delete (window as any).electron
    delete (window as any).__TAURI__
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('does not reach database restore or change localStorage after authentication failure', async () => {
    const filePath = 'memory://fixture/backup.lich13backup'
    await (window as any).api.file.write(filePath, new Uint8Array([1, 2, 3]))
    const storageBefore = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index)!
        return [key, localStorage.getItem(key)]
      })
    )

    await expect((window as any).api.backup.restore(filePath)).rejects.toThrow('fixture authentication failed')

    expect(mocks.decryptPortableBackup).toHaveBeenCalledWith([1, 2, 3])
    expect(mocks.invoke).not.toHaveBeenCalledWith('restore_backup_archive', expect.anything())
    expect(localStorage.length).toBe(Object.keys(storageBefore).length)
    for (const [key, value] of Object.entries(storageBefore)) expect(localStorage.getItem(key)).toBe(value)
    expect((indexedDB as any).open).not.toHaveBeenCalled()
  })
})
