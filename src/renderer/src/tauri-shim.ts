type AnyRecord = Record<string, any>

const globalWindow = window as AnyRecord
globalWindow.__LICH13_TAURI_SHIM__ = true
const tauri = globalWindow.__TAURI__
const previewMode = new URL(window.location.href).searchParams.has('tauri-preview')
const mockInvoke = async (command: string) => {
  if (command === 'app_info') {
    return {
      version: '1.9.1-preview',
      isPackaged: false,
      appPath: '/preview/resources',
      configPath: '/preview/config',
      appDataPath: '/preview/data',
      resourcesPath: '/preview/resources',
      filesPath: '/preview/data/files',
      notesPath: '/preview/data/notes',
      logsPath: '/preview/logs',
      arch: 'arm64',
      isPortable: false,
      installPath: '/preview',
      bundleId: 'com.lich13.studio',
      runtime: 'tauri-preview',
      platform: 'darwin',
      statePath: '/preview/data/state.json'
    }
  }

  if (command === 'webdav_restore' || command === 's3_restore') {
    return buildBackupSnapshot()
  }

  if (
    command === 'webdav_backup' ||
    command === 's3_backup' ||
    command === 'test_provider' ||
    command === 'test_mcp'
  ) {
    return true
  }

  return null
}
const invoke = tauri?.core?.invoke ?? (previewMode ? mockInvoke : undefined)
const getCurrentWindow = tauri?.window?.getCurrentWindow ? () => tauri.window.getCurrentWindow() : null

const isTauriRuntime = typeof invoke === 'function'

if (!globalWindow.root) {
  globalWindow.root = document.documentElement
}

if (!globalWindow.navigate) {
  globalWindow.navigate = (to: string) => {
    const normalized = to.startsWith('#') ? to : `#${to}`
    window.location.hash = normalized
  }
}

if (!globalWindow.toast) {
  const log = (level: 'log' | 'warn' | 'error', payload: any) => console[level]('[tauri-shim:toast]', payload)
  globalWindow.toast = {
    getToastQueue: () => [],
    addToast: () => undefined,
    closeToast: () => undefined,
    closeAll: () => undefined,
    isToastClosing: () => false,
    error: (payload: any) => log('error', payload),
    success: (payload: any) => log('log', payload),
    warning: (payload: any) => log('warn', payload),
    info: (payload: any) => log('log', payload),
    loading: (payload: any) => log('log', payload)
  }
}

if (!globalWindow.modal) {
  globalWindow.modal = {
    confirm: async () => true,
    error: async () => undefined,
    warning: async () => undefined,
    info: async () => undefined,
    success: async () => undefined
  }
}

const platform = navigator.userAgent.includes('Mac')
  ? 'darwin'
  : navigator.userAgent.includes('Windows')
    ? 'win32'
    : 'linux'

const fileCache = new Map<string, { fileName: string; ext: string; blob: Blob; text?: string }>()
const fileObjectMap = new WeakMap<File, string>()
let cachedAppInfo: AnyRecord | null = null

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createCleanup = () => () => {}

const normalizeExt = (fileName: string) => {
  const match = /\.([^.]+)$/.exec(fileName)
  return match ? `.${match[1]}` : ''
}

const serializeLocalStorage = () => {
  const snapshot: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue
    const value = localStorage.getItem(key)
    if (value !== null) {
      snapshot[key] = value
    }
  }
  return snapshot
}

const buildBackupSnapshot = () => ({
  time: Date.now(),
  version: 5,
  localStorage: serializeLocalStorage(),
  indexedDB: {}
})

const registerBlob = async (blob: Blob, fileName: string, explicitPath?: string) => {
  const ext = normalizeExt(fileName)
  const id = createId('file')
  const cacheKey = explicitPath || `memory://${id}/${fileName}`
  fileCache.set(cacheKey, { fileName, ext, blob })
  fileCache.set(`${id}${ext}`, { fileName, ext, blob })

  return {
    id,
    name: fileName.replace(ext, ''),
    origin_name: fileName,
    ext,
    filePath: cacheKey,
    path: cacheKey,
    size: blob.size,
    type: blob.type.startsWith('image/')
      ? 'image'
      : blob.type.startsWith('text/')
        ? 'text'
        : blob.type.includes('pdf') || blob.type.includes('json') || blob.type.includes('markdown')
          ? 'document'
          : 'other',
    created_at: new Date().toISOString()
  }
}

const registerBrowserFile = async (file: File) => {
  const existing = fileObjectMap.get(file)
  if (existing) {
    return existing
  }
  const meta = await registerBlob(file, file.name)
  fileObjectMap.set(file, meta.path)
  return meta.path
}

const getCachedFile = async (fileIdOrPath: string) => {
  const direct = fileCache.get(fileIdOrPath)
  if (direct) {
    return direct
  }
  for (const [key, value] of fileCache.entries()) {
    if (key.endsWith(`/${fileIdOrPath}`)) {
      return value
    }
  }
  return undefined
}

const readBlobAsText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsText(blob)
  })

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(blob)
  })

const readBlobAsUint8Array = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const toBlobPart = (data: Uint8Array) => {
  const clone = new Uint8Array(data.byteLength)
  clone.set(data)
  return clone.buffer
}

const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const pickFiles = async (multiple = true, filters?: Array<{ name: string; extensions: string[] }>) =>
  new Promise<any[] | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    const accepted = filters?.flatMap((filter) => filter.extensions.map((extension) => `.${extension}`)).join(',')
    if (accepted) {
      input.accept = accepted
    }
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      if (files.length === 0) {
        resolve(null)
        return
      }
      const metas = await Promise.all(
        files.map(async (file) => {
          const path = await registerBrowserFile(file)
          const meta = await getCachedFile(path)
          const ext = normalizeExt(file.name)
          return {
            id: path.split('/')[2] || createId('file'),
            name: file.name.replace(ext, ''),
            origin_name: file.name,
            ext,
            filePath: path,
            path,
            size: file.size,
            type: meta?.blob.type.startsWith('image/')
              ? 'image'
              : meta?.blob.type.startsWith('text/')
                ? 'text'
                : 'document',
            created_at: new Date().toISOString()
          }
        })
      )
      resolve(metas)
    }
    input.click()
  })

const getAppInfo = async () => {
  if (cachedAppInfo) {
    return cachedAppInfo
  }
  const info = await invoke('app_info')
  cachedAppInfo = info
  return info
}

const noOpAsync = async (..._args: any[]) => undefined

const fallbackCallable = (path = 'api') => {
  const fn = (..._args: any[]) => Promise.resolve(undefined)
  return new Proxy(fn, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return () => createCleanup()
      }
      if (prop === 'subscribe' || prop === 'unsubscribe') {
        return noOpAsync
      }
      return fallbackCallable(`${path}.${String(prop)}`)
    },
    apply() {
      return Promise.resolve(undefined)
    }
  })
}

const api = {
  getAppInfo,
  getDiskInfo: async () => null,
  reload: async () => location.reload(),
  quit: async () => getCurrentWindow?.()?.close?.(),
  setProxy: noOpAsync,
  checkForUpdate: async () => ({ updateInfo: null }),
  quitAndInstall: noOpAsync,
  setLanguage: async (lang: string) => {
    localStorage.setItem('tauri:language', lang)
  },
  setEnableSpellCheck: noOpAsync,
  setSpellCheckLanguages: noOpAsync,
  setLaunchOnBoot: noOpAsync,
  setLaunchToTray: noOpAsync,
  setTray: noOpAsync,
  setTrayOnClose: noOpAsync,
  setTestPlan: noOpAsync,
  setTestChannel: noOpAsync,
  setTheme: async (theme: string) => {
    localStorage.setItem('tauri:theme', theme)
  },
  handleZoomFactor: noOpAsync,
  setAutoUpdate: noOpAsync,
  select: async (options?: AnyRecord) => {
    if (options?.properties?.includes?.('openDirectory')) {
      if (invoke) {
        return invoke('pick_folder')
      }
      return null
    }
    return null
  },
  hasWritePermission: async () => true,
  resolvePath: async (value: string) => value,
  isPathInside: async (childPath: string, parentPath: string) =>
    childPath === parentPath || childPath.startsWith(parentPath),
  setAppDataPath: noOpAsync,
  getDataPathFromArgs: async () => null,
  copy: async () => true,
  setStopQuitApp: noOpAsync,
  flushAppData: noOpAsync,
  isNotEmptyDir: async () => false,
  relaunchApp: async () => location.reload(),
  resetData: async () => {
    localStorage.clear()
    location.reload()
  },
  openWebsite: async (url: string) => {
    if (invoke) {
      await invoke('open_path', { path: url })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  openPath: async (url: string) => {
    if (invoke) {
      return invoke('open_path', { path: url })
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  },
  getCacheSize: async () => '0 B',
  clearCache: noOpAsync,
  logToMain: noOpAsync,
  setFullScreen: async (value: boolean) => {
    if (value) {
      await document.documentElement.requestFullscreen?.()
    } else {
      await document.exitFullscreen?.()
    }
  },
  isFullScreen: async () => Boolean(document.fullscreenElement),
  getSystemFonts: async () => [],
  getIpCountry: async () => 'us',
  shell: {
    openExternal: async (url: string) => window.open(url, '_blank', 'noopener,noreferrer')
  },
  notification: {
    send: async () => true
  },
  system: {
    getDeviceType: async () => 'desktop',
    getHostname: async () => globalWindow.location.hostname || 'localhost',
    getCpuName: async () => navigator.userAgent,
    checkGitBash: async () => false,
    getGitBashPath: async () => null,
    getGitBashPathInfo: async () => ({ path: null, source: 'tauri', exists: false }),
    setGitBashPath: async () => false
  },
  devTools: {
    toggle: async () => undefined
  },
  zip: {
    compress: async (text: string) => new TextEncoder().encode(text),
    decompress: async (input: Uint8Array | ArrayBuffer | string) => {
      if (typeof input === 'string') return input
      return new TextDecoder().decode(input instanceof Uint8Array ? input : new Uint8Array(input))
    }
  },
  storeSync: {
    onUpdate: noOpAsync,
    subscribe: noOpAsync,
    unsubscribe: noOpAsync
  },
  window: {
    setMinimumSize: noOpAsync,
    resetMinimumSize: noOpAsync,
    getSize: async () => [window.innerWidth, window.innerHeight]
  },
  windowControls: {
    isMaximized: async () => false,
    onMaximizedChange: () => createCleanup(),
    minimize: async () => getCurrentWindow?.()?.minimize?.(),
    maximize: async () => getCurrentWindow?.()?.maximize?.(),
    unmaximize: async () => getCurrentWindow?.()?.unmaximize?.(),
    close: async () => getCurrentWindow?.()?.close?.()
  },
  config: {
    set: async (key: string, value: any) => {
      localStorage.setItem(`config:${key}`, JSON.stringify(value))
    },
    get: async (key: string) => {
      const raw = localStorage.getItem(`config:${key}`)
      return raw ? JSON.parse(raw) : null
    }
  },
  trace: {
    saveEntity: noOpAsync,
    tokenUsage: noOpAsync,
    addStreamMessage: noOpAsync,
    cleanHistory: noOpAsync,
    openWindow: noOpAsync,
    getData: async () => []
  },
  searchService: {
    openUrlInSearchWindow: async (_uid: string, url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
      return url
    },
    closeSearchWindow: noOpAsync
  },
  file: {
    select: async (options?: AnyRecord) => pickFiles(Boolean(options?.properties?.includes?.('multiSelections')), options?.filters),
    open: async (options?: AnyRecord) => {
      const files = await pickFiles(false, options?.filters)
      return files?.[0] || null
    },
    upload: async (file: AnyRecord) => file,
    delete: async (fileId: string) => {
      fileCache.delete(fileId)
      return true
    },
    deleteDir: async () => true,
    deleteExternalFile: async () => true,
    deleteExternalDir: async () => true,
    move: async () => true,
    moveDir: async () => true,
    rename: async () => true,
    renameDir: async () => true,
    read: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) return ''
      cached.text = cached.text ?? (await readBlobAsText(cached.blob))
      return cached.text
    },
    readExternal: async (filePath: string) => {
      const cached = await getCachedFile(filePath)
      if (!cached) return ''
      cached.text = cached.text ?? (await readBlobAsText(cached.blob))
      return cached.text
    },
    clear: async () => {
      fileCache.clear()
    },
    get: async (filePath: string) => {
      const cached = await getCachedFile(filePath)
      if (!cached) return null
      const meta = await registerBlob(cached.blob, cached.fileName, filePath)
      return meta
    },
    createTempFile: async (fileName: string) => {
      const path = `memory://temp/${createId('tmp')}/${fileName}`
      fileCache.set(path, { fileName, ext: normalizeExt(fileName), blob: new Blob([]), text: '' })
      return path
    },
    mkdir: async () => true,
    write: async (filePath: string, data: Uint8Array | string) => {
      const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : new Blob([toBlobPart(data)])
      const current = fileCache.get(filePath)
      fileCache.set(filePath, {
        fileName: current?.fileName || filePath.split('/').pop() || 'file.txt',
        ext: current?.ext || normalizeExt(filePath),
        blob
      })
      return true
    },
    writeWithId: async (id: string, content: string) => {
      localStorage.setItem(`file:${id}`, content)
      return true
    },
    openPath: async (path: string) => {
      const cached = await getCachedFile(path)
      if (cached) {
        const url = URL.createObjectURL(cached.blob)
        window.open(url, '_blank', 'noopener,noreferrer')
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        return true
      }
      if (/^https?:/i.test(path) || /^file:/i.test(path)) {
        window.open(path, '_blank', 'noopener,noreferrer')
      }
      return true
    },
    showInFolder: async (path: string) => api.file.openPath(path),
    save: async (name: string, content: string | Uint8Array) => {
      const blob =
        typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : new Blob([toBlobPart(content)])
      downloadBlob(name, blob)
      return true
    },
    selectFolder: async () => {
      if (invoke) {
        const selected = await invoke('pick_folder')
        if (selected) {
          return selected
        }
      }
      return (await getAppInfo()).appDataPath
    },
    saveImage: async (name: string, data: string) => {
      const blob = await (await fetch(data)).blob()
      downloadBlob(`${name}.png`, blob)
      return true
    },
    binaryImage: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) return new Uint8Array()
      return readBlobAsUint8Array(cached.blob)
    },
    base64Image: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) {
        return { mime: 'application/octet-stream', base64: '', data: '' }
      }
      const data = await readBlobAsDataUrl(cached.blob)
      return {
        mime: cached.blob.type || 'application/octet-stream',
        base64: data.split(',')[1] || '',
        data
      }
    },
    saveBase64Image: async (data: string) => {
      const blob = await (await fetch(data)).blob()
      const meta = await registerBlob(blob, `image-${Date.now()}.png`)
      downloadBlob(meta.origin_name, blob)
      return meta
    },
    savePastedImage: async (imageData: Uint8Array, extension = 'png') => {
      const fileName = `pasted-${Date.now()}.${extension}`
      const blob = new Blob([toBlobPart(imageData)], { type: `image/${extension}` })
      return registerBlob(blob, fileName)
    },
    download: async (url: string) => {
      const response = await fetch(url)
      const blob = await response.blob()
      const fileName = url.split('/').pop()?.split('?')[0] || `download-${Date.now()}`
      const meta = await registerBlob(blob, fileName)
      downloadBlob(fileName, blob)
      return meta
    },
    copy: async () => true,
    base64File: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) return ''
      return readBlobAsDataUrl(cached.blob)
    },
    pdfInfo: async () => null,
    getPathForFile: (file: File) => {
      const existing = fileObjectMap.get(file)
      if (existing) return existing
      const pseudoPath = `memory://pending/${createId('file')}/${file.name}`
      fileObjectMap.set(file, pseudoPath)
      void registerBrowserFile(file)
      return pseudoPath
    },
    openFileWithRelativePath: async (file: AnyRecord) => api.file.openPath(file?.path || file?.filePath || ''),
    isTextFile: async (filePath: string) => /\.(txt|md|markdown|json|js|ts|tsx|jsx|html|css|csv)$/i.test(filePath),
    isDirectory: async () => false,
    getDirectoryStructure: async () => [],
    listDirectory: async () => [],
    checkFileName: async (_dirPath: string, fileName: string) => ({ safeName: fileName, exists: false }),
    validateNotesDirectory: async () => true,
    pauseFileWatcher: noOpAsync,
    resumeFileWatcher: noOpAsync,
    startFileWatcher: noOpAsync,
    stopFileWatcher: noOpAsync,
    onFileChange: () => createCleanup(),
    batchUploadMarkdown: async () => ({ success: [], failed: [] })
  },
  backup: {
    restore: async (filePath: string) => {
      const cached = await getCachedFile(filePath)
      if (!cached) return ''
      return readBlobAsText(cached.blob)
    },
    backup: async (fileName: string) => {
      const blob = new Blob([JSON.stringify(buildBackupSnapshot(), null, 2)], { type: 'application/json' })
      downloadBlob(fileName.replace(/\.zip$/i, '.json'), blob)
      return true
    },
    backupToWebdav: async (webdavConfig: AnyRecord) => {
      const snapshot = buildBackupSnapshot()
      const config = {
        url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
        username: webdavConfig.webdavUser || '',
        password: webdavConfig.webdavPass || '',
        fileName: webdavConfig.fileName || 'lich13studio-backup.json'
      }
      await invoke('webdav_backup', { state: snapshot, config })
      return true
    },
    restoreFromWebdav: async (webdavConfig: AnyRecord) => {
      const config = {
        url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
        username: webdavConfig.webdavUser || '',
        password: webdavConfig.webdavPass || '',
        fileName: webdavConfig.fileName || 'lich13studio-backup.json'
      }
      const data = await invoke('webdav_restore', { config })
      return JSON.stringify(data)
    },
    listWebdavFiles: async (webdavConfig: AnyRecord) => {
      if (!invoke) return []
      const config = {
        url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
        username: webdavConfig.webdavUser || '',
        password: webdavConfig.webdavPass || '',
        fileName: webdavConfig.fileName || 'lich13studio-backup.json'
      }
      const files = await invoke('list_webdav_files', { config })
      return files.map((file: AnyRecord) => ({
        fileName: file.fileName,
        modifiedTime: file.modifiedTime,
        size: file.size
      }))
    },
    checkConnection: async (webdavConfig: AnyRecord) => Boolean(webdavConfig?.webdavHost),
    createDirectory: async () => true,
    deleteWebdavFile: async (fileName: string, webdavConfig: AnyRecord) => {
      if (!invoke) return true
      const config = {
        url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
        username: webdavConfig.webdavUser || '',
        password: webdavConfig.webdavPass || '',
        fileName: webdavConfig.fileName || 'lich13studio-backup.json'
      }
      return invoke('delete_webdav_file', { fileName, config })
    },
    backupToLocalDir: async (fileName: string, localConfig?: AnyRecord) => {
      const payload = JSON.stringify(buildBackupSnapshot(), null, 2)
      if (invoke) {
        await invoke('backup_to_local_dir', {
          fileName,
          localBackupDir: localConfig?.localBackupDir || null,
          payload
        })
        return true
      }
      const blob = new Blob([payload], { type: 'application/json' })
      downloadBlob(fileName.replace(/\.zip$/i, '.json'), blob)
      return true
    },
    restoreFromLocalBackup: async (fileName: string, localBackupDir?: string) => {
      if (!invoke) return undefined
      return invoke('restore_from_local_backup', { fileName, localBackupDir: localBackupDir || null })
    },
    listLocalBackupFiles: async (localBackupDir?: string) => {
      if (!invoke) return []
      const files = await invoke('list_local_backup_files', { localBackupDir: localBackupDir || null })
      return files.map((file: AnyRecord) => ({
        fileName: file.fileName,
        modifiedTime: file.modifiedTime,
        size: file.size
      }))
    },
    deleteLocalBackupFile: async (fileName: string, localBackupDir?: string) => {
      if (!invoke) return true
      return invoke('delete_local_backup_file', { fileName, localBackupDir: localBackupDir || null })
    },
    checkWebdavConnection: async (webdavConfig: AnyRecord) => Boolean(webdavConfig?.webdavHost),
    backupToS3: async (s3Config: AnyRecord) => {
      const snapshot = buildBackupSnapshot()
      const config = {
        endpoint: s3Config.endpoint || '',
        region: s3Config.region || 'us-east-1',
        bucket: s3Config.bucket || '',
        accessKey: s3Config.accessKeyId || '',
        secretKey: s3Config.secretAccessKey || '',
        objectKey: [s3Config.root, s3Config.fileName || 'lich13studio-backup.json'].filter(Boolean).join('/'),
        pathStyle: true
      }
      await invoke('s3_backup', { state: snapshot, config })
      return true
    },
    restoreFromS3: async (s3Config: AnyRecord) => {
      const config = {
        endpoint: s3Config.endpoint || '',
        region: s3Config.region || 'us-east-1',
        bucket: s3Config.bucket || '',
        accessKey: s3Config.accessKeyId || '',
        secretKey: s3Config.secretAccessKey || '',
        objectKey: [s3Config.root, s3Config.fileName || 'lich13studio-backup.json'].filter(Boolean).join('/'),
        pathStyle: true
      }
      const data = await invoke('s3_restore', { config })
      return JSON.stringify(data)
    },
    listS3Files: async (s3Config: AnyRecord) => {
      if (!invoke) return []
      const config = {
        endpoint: s3Config.endpoint || '',
        region: s3Config.region || 'us-east-1',
        bucket: s3Config.bucket || '',
        accessKey: s3Config.accessKeyId || '',
        secretKey: s3Config.secretAccessKey || '',
        objectKey: s3Config.fileName || 'lich13studio-backup.json',
        root: s3Config.root || '',
        pathStyle: true
      }
      const files = await invoke('list_s3_files', { config })
      return files.map((file: AnyRecord) => ({
        fileName: file.fileName,
        modifiedTime: file.modifiedTime,
        size: file.size
      }))
    },
    deleteS3File: async (fileName: string, s3Config: AnyRecord) => {
      if (!invoke) return true
      const config = {
        endpoint: s3Config.endpoint || '',
        region: s3Config.region || 'us-east-1',
        bucket: s3Config.bucket || '',
        accessKey: s3Config.accessKeyId || '',
        secretKey: s3Config.secretAccessKey || '',
        objectKey: s3Config.fileName || 'lich13studio-backup.json',
        root: s3Config.root || '',
        pathStyle: true
      }
      return invoke('delete_s3_file', { fileName, config })
    },
    checkS3Connection: async (s3Config: AnyRecord) => Boolean(s3Config?.endpoint && s3Config?.bucket),
    createLanTransferBackup: async () => '',
    deleteLanTransferBackup: async () => true
  },
  mcp: {
    listTools: async () => [],
    listPrompts: async () => [],
    listResources: async () => [],
    getServerVersion: async () => 'tauri-runtime',
    getServerLogs: async () => [],
    onServerLog: () => createCleanup(),
    restartServer: async () => true,
    removeServer: async () => true,
    stopServer: async () => true,
    uploadDxt: async () => ({ success: false, message: 'DXT install is not available in Tauri yet.' }),
    getInstallInfo: async () => ({ uvPath: '', bunPath: '', dir: '' }),
    getPrompt: async () => ({ description: '', messages: [] }),
    getResource: async () => ({ uri: '', mimeType: '', text: '' }),
    resolveHubTool: async () => null,
    checkMcpConnectivity: async (server: AnyRecord) => {
      if (!invoke) return false
      const payload = {
        transport: server.type === 'stdio' ? 'local' : 'remote',
        command: server.command || '',
        args: server.args || [],
        url: server.baseUrl || server.url || ''
      }
      return invoke('check_mcp_connectivity', { server: payload })
    },
    abortTool: async () => true,
    callTool: async () => ({ content: [] })
  }
} as AnyRecord

if (isTauriRuntime) {
  globalWindow.electron = globalWindow.electron || {
    process: { platform },
    ipcRenderer: {
      on: () => createCleanup(),
      once: () => createCleanup(),
      invoke: async () => null,
      send: () => undefined,
      removeAllListeners: () => undefined
    }
  }

  globalWindow.api = new Proxy(api, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop]
      }
      return fallbackCallable(`api.${String(prop)}`)
    }
  })
}

export {}
