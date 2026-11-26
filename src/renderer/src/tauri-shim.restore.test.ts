// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  decryptPortableBackup: vi.fn(),
  credentialStorageEnabled: false,
  android: false,
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
  DESKTOP_RESET_NOTICE_STORAGE_KEY: 'lich13:desktop-credential-reset-notice',
  hydrateCredentials: (value: unknown) => value,
  mobilePersistStorage: { removeItem: mocks.removePersistedCredentials, getItem: vi.fn(), setItem: vi.fn() },
  stripCredentials: (value: unknown) => value
}))
vi.mock('./services/mobile/runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    mobileCommand: vi.fn(),
    runtimeCapabilities: {
      get android() {
        return mocks.android
      }
    }
  }
})
vi.mock('./utils/attachmentMime', () => ({
  attachmentMime: (_name: string, mime: string) => mime || 'application/octet-stream',
  managedAttachmentId: () => undefined
}))
vi.mock('./services/PortableBackupService', () => ({ decryptPortableBackup: mocks.decryptPortableBackup }))

describe('Tauri portable backup restore', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.credentialStorageEnabled = false
    mocks.android = false
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

    expect(mocks.decryptPortableBackup).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(mocks.invoke).not.toHaveBeenCalledWith('restore_backup_archive', expect.anything(), expect.anything())
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
    await expect((window as any).api.file.save('中文备份.md', '# hello')).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenLastCalledWith('save_file', expect.any(Uint8Array), {
      headers: { 'x-file-name': encodeURIComponent('中文备份.md') }
    })

    // On Android, postMessage IPC does not support InvokeBody::Raw, so binary payloads wrap base64 JSON.
    mocks.android = true
    mocks.invoke.mockResolvedValueOnce('content://saved.md')
    await expect((window as any).api.file.save('安卓备份.md', new TextEncoder().encode('# hello'))).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'save_file',
      { base64: btoa('# hello') },
      { headers: { 'x-file-name': encodeURIComponent('安卓备份.md') } }
    )
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

  it('extracts PDF text lazily via api.file.read(..., true)', async () => {
    mocks.extractPdfText.mockClear()
    await (window as any).api.file.write('memory://pdf/doc.pdf', new TextEncoder().encode('%PDF-1.4 bytes'))
    await expect((window as any).api.file.read('memory://pdf/doc.pdf', true)).resolves.toBe('Extracted PDF text')
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
  })

  it('excludes transient backup:committed-restore-id marker when exporting portable backup snapshots', async () => {
    ;(indexedDB as any).open = vi.fn(() => {
      const req: any = { onerror: null, onupgradeneeded: null, onsuccess: null, result: null }
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: ['settings', 'topics'],
          transaction: (names: string[]) => ({
            objectStore: () => ({
              getAll: () => {
                const getAllReq: any = { onerror: null, onsuccess: null, result: [] }
                queueMicrotask(() => {
                  getAllReq.result =
                    names[0] === 'settings'
                      ? [
                          { id: 'theme-pref', value: 'dark' },
                          { id: 'backup:committed-restore-id', value: 'restore-previous-transient' }
                        ]
                      : [{ id: 'topic-1', messages: [] }]
                  getAllReq.onsuccess?.()
                })
                return getAllReq
              }
            })
          }),
          close: vi.fn()
        }
        req.onsuccess?.()
      })
      return req
    })

    localStorage.setItem('lich13:desktop-credential-reset-notice', '{"clearedCount":1,"providers":[],"webdav":true}')
    const { buildBackupSnapshot } = await import('./tauri-shim')
    const snapshot = await buildBackupSnapshot(false)
    expect(snapshot.localStorage['lich13:desktop-credential-reset-notice']).toBeUndefined()
    expect(snapshot.indexedDB.settings).toEqual([{ id: 'theme-pref', value: 'dark' }])
    expect(snapshot.indexedDB.topics).toEqual([{ id: 'topic-1', messages: [] }])

    mocks.invoke.mockResolvedValueOnce({ payload: '{"version":5}', restoreId: 'restore-previous-webdav-1' })
    await expect(
      (window as any).api.backup.restoreFromWebdav({ webdavHost: 'https://dav.example.invalid' })
    ).resolves.toEqual({
      payload: '{"version":5}',
      restoreId: 'restore-previous-webdav-1'
    })
  })

  it('caps disk attachment cache at 16 MiB while preserving >16 MiB memory:// encrypted backups through restore', async () => {
    const oversizedDiskBytes = new Uint8Array(18 * 1024 * 1024)
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'read_attachment') return oversizedDiskBytes
      return undefined
    })

    // Normal disk-backed attachment > 16 MiB is served on demand without staying in JS RAM cache
    const readOnce = await (window as any).api.file.binaryImage('huge-disk-attachment.png')
    expect(readOnce.data.byteLength).toBe(18 * 1024 * 1024)
    expect(await (window as any).api.getCacheSize()).toBe('0 B')

    // >16 MiB memory:// encrypted backup is exempted from cache rejection AND protected from disk eviction
    const backupBytes = new Uint8Array(18 * 1024 * 1024)
    backupBytes[0] = 0x4c
    backupBytes[backupBytes.length - 1] = 0x9a
    const memoryBackupPath = 'memory://backup-large/archive.lich13backup'
    await (window as any).api.file.write(memoryBackupPath, backupBytes)

    // Concurrent normal disk attachment reads must NOT evict the memory:// backup entry
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'read_attachment') return new Uint8Array(4 * 1024 * 1024)
      return undefined
    })
    for (let idx = 0; idx < 6; idx += 1) {
      await (window as any).api.file.binaryImage(`disk-item-${idx}.bin`)
    }

    mocks.decryptPortableBackup.mockResolvedValueOnce({
      payload: '{"version":5,"localStorage":{"persist:cherry-studio":"{}"},"indexedDB":{}}',
      restoreId: 'restore-previous-large-enc'
    })

    const restored = await (window as any).api.backup.restore(memoryBackupPath)
    expect(restored).toEqual({
      payload: '{"version":5,"localStorage":{"persist:cherry-studio":"{}"},"indexedDB":{}}',
      restoreId: 'restore-previous-large-enc'
    })
    expect(mocks.decryptPortableBackup).toHaveBeenCalledTimes(1)
    const passedBytes: Uint8Array = mocks.decryptPortableBackup.mock.calls[0][0]
    expect(passedBytes.byteLength).toBe(18 * 1024 * 1024)
    expect(passedBytes[0]).toBe(0x4c)
    expect(passedBytes[passedBytes.length - 1]).toBe(0x9a)

    // Restore finally-block immediately reclaims the >16 MiB memory:// backup entry without waiting for clearCache()
    await expect((window as any).api.file.read(memoryBackupPath)).resolves.toBe('')

    await (window as any).api.clearCache()
    expect(await (window as any).api.getCacheSize()).toBe('0 B')
  })

  it('skips fileCache registration when picking inline-content .bak/.json backups via api.file.open across retries', async () => {
    await (window as any).api.clearCache()
    expect(await (window as any).api.getCacheSize()).toBe('0 B')

    const originalCreateElement = document.createElement.bind(document)
    let nextSelectedFile: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null =
      null

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const el = originalCreateElement(tagName)
      if (tagName.toLowerCase() === 'input') {
        Object.defineProperty(el, 'click', {
          configurable: true,
          value: () => {
            Object.defineProperty(el, 'files', {
              configurable: true,
              value: nextSelectedFile ? [nextSelectedFile] : []
            })
            void (el as HTMLInputElement).onchange?.(new Event('change') as any)
          }
        })
      }
      return el
    }) as typeof document.createElement)

    try {
      for (const fileName of ['corrupt-attempt-1.bak', 'corrupt-attempt-2.json']) {
        const rawBytes = new TextEncoder().encode(`{not-valid-backup-${fileName}`)
        nextSelectedFile = {
          name: fileName,
          type: 'application/octet-stream',
          size: rawBytes.byteLength,
          arrayBuffer: async () => rawBytes.slice().buffer
        }
        const picked = await (window as any).api.file.open({
          filters: [{ name: 'Backup', extensions: ['bak', 'zip', 'json', 'lich13backup'] }]
        })
        expect(picked).toMatchObject({
          fileName,
          filePath: expect.stringMatching(/^memory:\/\/backup-/),
          size: rawBytes.byteLength
        })
        expect(Array.from(picked.content)).toEqual(Array.from(rawBytes))
        // Must NOT leave any memory:// entry in fileCache even before BackupService.restore runs
        expect(await (window as any).api.getCacheSize()).toBe('0 B')
      }

      // Unreadable file rejects cleanly instead of hanging indefinitely and leaves zero cached bytes
      nextSelectedFile = {
        name: 'unreadable.bak',
        type: 'application/octet-stream',
        size: 16,
        arrayBuffer: async () => {
          throw new Error('NotReadableError: SAF URI revoked')
        }
      }
      await expect(
        (window as any).api.file.open({
          filters: [{ name: 'Backup', extensions: ['bak', 'zip', 'json', 'lich13backup'] }]
        })
      ).rejects.toThrow('NotReadableError')
      expect(await (window as any).api.getCacheSize()).toBe('0 B')
    } finally {
      createElementSpy.mockRestore()
    }
  })
})
