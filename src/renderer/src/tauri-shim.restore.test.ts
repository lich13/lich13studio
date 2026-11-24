// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  decryptPortableBackup: vi.fn(),
  credentialStorageEnabled: false,
  removePersistedCredentials: vi.fn(),
  extractPdfText: vi.fn(async () => 'Extracted PDF text')
}))

vi.mock('@shared/utils/pdf', () => ({
  extractPdfText: mocks.extractPdfText
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
  get credentialStorageEnabled() {
    return mocks.credentialStorageEnabled
  },
  hydrateCredentials: (value: unknown) => value,
  mobilePersistStorage: { removeItem: mocks.removePersistedCredentials, getItem: vi.fn(), setItem: vi.fn() },
  stripCredentials: (value: unknown) => value
}))
vi.mock('./services/mobile/runtime', () => ({
  mobileCommand: vi.fn(),
  runtimeCapabilities: { android: false }
}))
vi.mock('./utils/attachmentMime', () => ({
  attachmentMime: (_name: string, mime: string) => mime || 'application/octet-stream',
  managedAttachmentId: () => undefined
}))
vi.mock('./services/PortableBackupService', () => ({ decryptPortableBackup: mocks.decryptPortableBackup }))

describe('Tauri portable backup restore', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.credentialStorageEnabled = false
    mocks.removePersistedCredentials.mockReset().mockResolvedValue(undefined)
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.decryptPortableBackup.mockReset().mockRejectedValue(new Error('fixture authentication failed'))
    localStorage.clear()
    localStorage.setItem('persist:cherry-studio', JSON.stringify({ settings: JSON.stringify({ theme: 'dark' }) }))
    localStorage.setItem('tauri:app-data-path', '/stale/shadow-dir')
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

  it('returns structured base64File and binaryImage objects, formats MB cache size, and forwards delete_attachment', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'read_attachment') {
        return Array.from(new TextEncoder().encode('%PDF-1.4 fixture'))
      }
      return true
    })

    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL(blob: { arrayBuffer: () => Promise<ArrayBuffer>; type: string }) {
          void blob.arrayBuffer().then((buf) => {
            const bytes = new Uint8Array(buf)
            let bin = ''
            for (const byte of bytes) bin += String.fromCharCode(byte)
            this.result = `data:${blob.type || 'application/pdf'};base64,${btoa(bin)}`
            this.onload?.()
          })
        }
      }
    )

    const base64Pdf = await (window as any).api.file.base64File('pdf-1.pdf')
    expect(base64Pdf).toEqual({
      mime: 'application/octet-stream',
      base64: btoa('%PDF-1.4 fixture'),
      data: btoa('%PDF-1.4 fixture')
    })

    const binary = await (window as any).api.file.binaryImage('pdf-1.pdf')
    expect(binary.mime).toBe('application/octet-stream')
    expect(Array.from(binary.data)).toEqual(Array.from(new TextEncoder().encode('%PDF-1.4 fixture')))

    await (window as any).api.file.write('memory://large/cache.bin', new Uint8Array(2 * 1024 * 1024))
    expect(await (window as any).api.getCacheSize()).toMatch(/ MB$/)

    await (window as any).api.file.delete('pdf-1.pdf')
    expect(mocks.invoke).toHaveBeenCalledWith('delete_attachment', { name: 'pdf-1.pdf' })

    mocks.invoke.mockResolvedValueOnce('')
    await expect((window as any).api.file.save('cancelled.md', '# hello')).resolves.toBe(false)

    mocks.invoke.mockRejectedValueOnce(new Error('User canceled the save dialog'))
    await expect((window as any).api.file.save('cancelled.md', '# hello')).resolves.toBe(false)

    mocks.invoke.mockResolvedValueOnce('/tmp/saved.md')
    await expect((window as any).api.file.save('saved.md', '# hello')).resolves.toBe(true)
  })

  it('purges stale tauri:app-data-path shadow state and reclaims attachments/cache on resetData', async () => {
    expect(localStorage.getItem('tauri:app-data-path')).toBeNull()

    const nativeAppInfo = {
      version: '0.1.39',
      appDataPath: '/real/data',
      configPath: '/real/data',
      filesPath: '/real/data/Files',
      statePath: '/real/data/state.json'
    }
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'app_info') return nativeAppInfo
      return undefined
    })

    localStorage.setItem('tauri:app-data-path', '/injected/override')
    const resolvedInfo = await (window as any).api.getAppInfo()
    expect(resolvedInfo).toEqual(nativeAppInfo)

    await (window as any).api.setAppDataPath('/ignored/override')
    expect(localStorage.getItem('tauri:app-data-path')).toBe('/injected/override')

    await (window as any).api.file.write('memory://reset/attachment.bin', new Uint8Array(4096))
    expect(await (window as any).api.getCacheSize()).not.toBe('0 B')

    mocks.credentialStorageEnabled = true
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

    await (window as any).api.resetData()

    expect(mocks.invoke).toHaveBeenCalledWith('close_mini_window')
    expect(mocks.invoke).toHaveBeenCalledWith('clear_attachments')
    expect(mocks.removePersistedCredentials).toHaveBeenCalledWith('persist:cherry-studio')
    expect(localStorage.length).toBe(0)
    expect(await (window as any).api.getCacheSize()).toBe('0 B')
    expect(reloadSpy).toHaveBeenCalledTimes(1)

    mocks.invoke.mockClear()
    await (window as any).api.relaunchApp()
    expect(mocks.invoke).toHaveBeenCalledWith('close_mini_window')
    expect(reloadSpy).toHaveBeenCalledTimes(2)
  })

  it('extracts PDF text lazily via api.pdf.extractText and api.file.read(..., true)', async () => {
    mocks.extractPdfText.mockClear()
    const base64Pdf = btoa('%PDF-1.4 test')
    await expect((window as any).api.pdf.extractText(base64Pdf)).resolves.toBe('Extracted PDF text')
    expect(mocks.extractPdfText).toHaveBeenCalledWith(base64Pdf)

    await (window as any).api.file.write('memory://pdf/doc.pdf', new TextEncoder().encode('%PDF-1.4 bytes'))
    await expect((window as any).api.file.read('memory://pdf/doc.pdf', true)).resolves.toBe('Extracted PDF text')
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
  })
})
