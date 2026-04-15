type AnyRecord = Record<string, any>

const globalWindow = window as AnyRecord
globalWindow.__LICH13_TAURI_SHIM__ = true
const tauri = globalWindow.__TAURI__
const previewMode = new URL(window.location.href).searchParams.has('tauri-preview')
const mockInvoke = async (command: string) => {
  if (command === 'app_info') {
    return {
      version: '0.1.0-preview',
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

  if (command === 'webdav_restore') {
    return await buildBackupSnapshot()
  }

  if (
    command === 'webdav_backup' ||
    command === 'test_provider' ||
    command === 'test_mcp' ||
    command === 'check_webdav_connection' ||
    command === 'create_webdav_directory'
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

const THEME_STORAGE_KEY = 'tauri:theme'
const ZOOM_STORAGE_KEY = 'tauri:zoom-factor'
const APP_ZOOM_FACTOR_VAR = '--app-zoom-factor'
const APP_INVERSE_ZOOM_FACTOR_VAR = '--app-inverse-zoom-factor'
const APP_VIEWPORT_HEIGHT_VAR = '--app-viewport-height'
const APP_VIEWPORT_WIDTH_VAR = '--app-viewport-width'
const systemThemeMediaQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const themeListeners = new Set<(theme: 'light' | 'dark') => void>()

const resolveThemeMode = (theme: string | null | undefined): 'light' | 'dark' => {
  if (theme === 'light' || theme === 'dark') {
    return theme
  }

  return systemThemeMediaQuery?.matches ? 'dark' : 'light'
}

const emitThemeUpdated = (theme?: string | null) => {
  const resolvedTheme = resolveThemeMode(theme ?? localStorage.getItem(THEME_STORAGE_KEY))
  themeListeners.forEach((listener) => listener(resolvedTheme))
  return resolvedTheme
}

const clampZoomFactor = (factor: number) => {
  if (!Number.isFinite(factor)) {
    return 1
  }

  return Math.min(2, Math.max(0.5, Math.round(factor * 100) / 100))
}

let currentZoomFactor = clampZoomFactor(Number.parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY) || '1'))

const applyZoomFactor = (factor: number) => {
  currentZoomFactor = clampZoomFactor(factor)
  localStorage.setItem(ZOOM_STORAGE_KEY, String(currentZoomFactor))
  document.documentElement.style.setProperty(APP_ZOOM_FACTOR_VAR, String(currentZoomFactor))
  document.documentElement.style.setProperty(APP_INVERSE_ZOOM_FACTOR_VAR, String(1 / currentZoomFactor))
  document.documentElement.style.setProperty(APP_VIEWPORT_HEIGHT_VAR, `calc(100vh / ${currentZoomFactor})`)
  document.documentElement.style.setProperty(APP_VIEWPORT_WIDTH_VAR, `calc(100vw / ${currentZoomFactor})`)
  document.documentElement.style.setProperty('zoom', String(currentZoomFactor))
  return currentZoomFactor
}

applyZoomFactor(currentZoomFactor)

const fontCandidatesByPlatform: Record<string, string[]> = {
  darwin: [
    'SF Pro Text',
    'SF Pro Display',
    'Helvetica Neue',
    'Helvetica',
    'Arial',
    'PingFang SC',
    'Hiragino Sans GB',
    'Songti SC',
    'STHeiti',
    'Menlo',
    'Monaco',
    'Courier New',
    'Times New Roman'
  ],
  win32: [
    'Segoe UI',
    'Microsoft YaHei UI',
    'Microsoft YaHei',
    'SimHei',
    'SimSun',
    'Arial',
    'Tahoma',
    'Verdana',
    'Cascadia Code',
    'Consolas',
    'Courier New',
    'Times New Roman'
  ],
  linux: [
    'Ubuntu',
    'Noto Sans',
    'Noto Sans CJK SC',
    'DejaVu Sans',
    'Liberation Sans',
    'Arial',
    'Verdana',
    'Fira Code',
    'DejaVu Sans Mono',
    'Liberation Mono',
    'Courier New',
    'Times New Roman'
  ]
}

let cachedSystemFonts: string[] | null = null

const detectSystemFontsFromDocument = (fonts: string[]) => {
  const documentFonts = (document as AnyRecord).fonts
  if (!documentFonts?.check) {
    return fonts
  }

  return fonts.filter((font) => {
    try {
      return documentFonts.check(`16px "${font}"`)
    } catch {
      return false
    }
  })
}

const getSystemFonts = async () => {
  if (cachedSystemFonts) {
    return cachedSystemFonts
  }

  const queryLocalFonts = globalWindow.queryLocalFonts as undefined | (() => Promise<Array<{ family?: string }>>)

  if (typeof queryLocalFonts === 'function') {
    try {
      const fonts = await queryLocalFonts()
      const localFonts = Array.from(new Set(fonts.map((font) => font.family?.trim()).filter(Boolean) as string[])).sort(
        (left, right) => left.localeCompare(right)
      )

      if (localFonts.length > 0) {
        cachedSystemFonts = localFonts
        return localFonts
      }
    } catch {
      // Fall back to heuristic detection when local font access is unavailable.
    }
  }

  const detectedFonts = detectSystemFontsFromDocument(
    fontCandidatesByPlatform[platform] || fontCandidatesByPlatform.linux
  )
  cachedSystemFonts = Array.from(new Set(detectedFonts)).sort((left, right) => left.localeCompare(right))
  return cachedSystemFonts
}

if (systemThemeMediaQuery) {
  const handleSystemThemeChange = () => {
    if ((localStorage.getItem(THEME_STORAGE_KEY) || 'system') === 'system') {
      emitThemeUpdated('system')
    }
  }

  if (typeof systemThemeMediaQuery.addEventListener === 'function') {
    systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange)
  } else {
    systemThemeMediaQuery.addListener?.(handleSystemThemeChange)
  }
}

const fileCache = new Map<string, { fileName: string; ext: string; blob: Blob; text?: string }>()
const fileObjectMap = new WeakMap<File, string>()
let cachedAppInfo: AnyRecord | null = null
type ProgressPayload = {
  stage: string
  progress: number
  total: number
}

type ProtocolPayload = {
  url: string
  params: Record<string, string>
}

const backupProgressListeners = new Set<(data: ProgressPayload) => void>()
const restoreProgressListeners = new Set<(data: ProgressPayload) => void>()
const protocolListeners = new Set<(data: ProtocolPayload) => void>()
let deepLinkUnlistenPromise: Promise<unknown> | null = null

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createCleanup = () => () => {}

const normalizeExt = (fileName: string) => {
  const match = /\.([^.]+)$/.exec(fileName)
  return match ? `.${match[1]}` : ''
}

const clampProgress = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

const emitProgress = (listeners: Set<(data: ProgressPayload) => void>, payload: ProgressPayload) => {
  const nextPayload = {
    ...payload,
    progress: clampProgress(payload.progress),
    total: payload.total || 100
  }

  listeners.forEach((listener) => {
    try {
      listener(nextPayload)
    } catch (error) {
      console.error('[tauri-shim] Progress listener failed', error)
    }
  })
}

const emitBackupProgress = (payload: ProgressPayload) => emitProgress(backupProgressListeners, payload)
const emitRestoreProgress = (payload: ProgressPayload) => emitProgress(restoreProgressListeners, payload)

const waitForNextFrame = async () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })

const toProtocolPayload = (url: string): ProtocolPayload => {
  try {
    const parsed = new URL(url)
    return {
      url,
      params: Object.fromEntries(parsed.searchParams.entries())
    }
  } catch {
    return {
      url,
      params: {}
    }
  }
}

const emitProtocolPayload = (url: string) => {
  const payload = toProtocolPayload(url)
  protocolListeners.forEach((listener) => {
    try {
      listener(payload)
    } catch (error) {
      console.error('[tauri-shim] Protocol listener failed', error)
    }
  })
}

const ensureDeepLinkListener = () => {
  if (deepLinkUnlistenPromise) {
    return
  }

  const deepLink = (tauri as AnyRecord)?.deepLink
  const onOpenUrl = deepLink?.onOpenUrl

  if (typeof onOpenUrl !== 'function') {
    return
  }

  deepLinkUnlistenPromise = Promise.resolve(
    onOpenUrl((urlsOrPayload: string[] | { urls?: string[]; url?: string }) => {
      const urls = Array.isArray(urlsOrPayload)
        ? urlsOrPayload
        : Array.isArray(urlsOrPayload?.urls)
          ? urlsOrPayload.urls
          : urlsOrPayload?.url
            ? [urlsOrPayload.url]
            : []

      urls.forEach((url) => emitProtocolPayload(url))
    })
  ).catch((error) => {
    console.warn('[tauri-shim] Failed to register deep-link listener', error)
    deepLinkUnlistenPromise = null
  })
}

const mapWebdavConfig = (webdavConfig: AnyRecord) => ({
  url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
  username: webdavConfig.webdavUser || '',
  password: webdavConfig.webdavPass || '',
  fileName: webdavConfig.fileName || 'lich13studio-backup.zip',
  skipBackupFile: Boolean(webdavConfig.skipBackupFile),
  userAgent: webdavConfig.userAgent || ''
})

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

const openAppIndexedDb = () =>
  new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('CherryStudio')
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'))
    request.onupgradeneeded = () => resolve(request.result)
    request.onsuccess = () => resolve(request.result)
  })

const serializeIndexedDb = async (onProgress?: (progress: number) => void) => {
  try {
    const db = await openAppIndexedDb()
    if (!db) {
      return {}
    }

    const snapshot: Record<string, any[]> = {}
    const storeNames = Array.from(db.objectStoreNames)

    for (const storeName of storeNames) {
      snapshot[storeName] = await new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly')
        const request = transaction.objectStore(storeName).getAll()
        request.onerror = () => reject(request.error || new Error(`Failed to read ${storeName}`))
        request.onsuccess = () => resolve(request.result || [])
      })
      onProgress?.((snapshot[storeName] ? Object.keys(snapshot).length : 0) / Math.max(storeNames.length, 1))
      await waitForNextFrame()
    }

    db.close()
    return snapshot
  } catch (error) {
    console.warn('[tauri-shim] Failed to serialize IndexedDB backup snapshot', error)
    return {}
  }
}

const buildBackupSnapshot = async () => {
  emitBackupProgress({ stage: 'preparing', progress: 5, total: 100 })
  await waitForNextFrame()

  const localStorageSnapshot = serializeLocalStorage()
  emitBackupProgress({ stage: 'writing_data', progress: 12, total: 100 })
  await waitForNextFrame()

  const indexedDBSnapshot = await serializeIndexedDb((progress) => {
    emitBackupProgress({
      stage: 'copying_database',
      progress: 15 + progress * 45,
      total: 100
    })
  })

  emitBackupProgress({ stage: 'preparing_compression', progress: 65, total: 100 })
  await waitForNextFrame()

  return {
    time: Date.now(),
    version: 5,
    localStorage: localStorageSnapshot,
    indexedDB: indexedDBSnapshot
  }
}

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
    fileName,
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
    created_at: new Date().toISOString(),
    count: 1
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
          const content = new Uint8Array(await file.arrayBuffer())
          return {
            id: path.split('/')[2] || createId('file'),
            name: file.name.replace(ext, ''),
            origin_name: file.name,
            fileName: file.name,
            ext,
            filePath: path,
            path,
            size: file.size,
            type: meta?.blob.type.startsWith('image/')
              ? 'image'
              : meta?.blob.type.startsWith('text/')
                ? 'text'
                : 'document',
            created_at: new Date().toISOString(),
            count: 1,
            content
          }
        })
      )
      resolve(metas)
    }
    input.click()
  })

const getAppDataOverride = () => localStorage.getItem('tauri:app-data-path') || null

const computeCacheSizeBytes = () => {
  let bytes = 0

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue
    const value = localStorage.getItem(key) || ''
    bytes += (key.length + value.length) * 2
  }

  fileCache.forEach((cached, key) => {
    bytes += key.length * 2
    bytes += cached.fileName.length * 2
    bytes += cached.text?.length ? cached.text.length * 2 : 0
    bytes += cached.blob.size
  })

  return bytes
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)}`
}

const getAppInfo = async () => {
  if (cachedAppInfo) {
    return cachedAppInfo
  }
  const info = await invoke('app_info')
  const appDataOverride = getAppDataOverride()
  cachedAppInfo = appDataOverride
    ? {
        ...info,
        appDataPath: appDataOverride,
        configPath: appDataOverride,
        filesPath: `${appDataOverride}/Files`,
        logsPath: `${appDataOverride}/Logs`,
        notesPath: `${appDataOverride}/Notes`,
        statePath: `${appDataOverride}/state.json`
      }
    : info
  return cachedAppInfo
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
    const normalizedTheme = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
    localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme)
    emitThemeUpdated(normalizedTheme)
  },
  handleZoomFactor: async (delta: number, reset: boolean = false) => {
    if (reset) {
      return applyZoomFactor(1)
    }

    if (delta === 0) {
      return currentZoomFactor
    }

    return applyZoomFactor(currentZoomFactor + delta)
  },
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
  setAppDataPath: async (path: string) => {
    if (!path) return
    localStorage.setItem('tauri:app-data-path', path)
    cachedAppInfo = null
  },
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
  getCacheSize: async () => formatBytes(computeCacheSizeBytes()),
  clearCache: async () => {
    fileCache.clear()
  },
  logToMain: noOpAsync,
  onThemeUpdated: (callback: (theme: 'light' | 'dark') => void) => {
    themeListeners.add(callback)
    callback(emitThemeUpdated())
    return () => {
      themeListeners.delete(callback)
    }
  },
  setFullScreen: async (value: boolean) => {
    if (value) {
      await document.documentElement.requestFullscreen?.()
    } else {
      await document.exitFullscreen?.()
    }
  },
  isFullScreen: async () => Boolean(document.fullscreenElement),
  getSystemFonts,
  getIpCountry: async () => 'us',
  shell: {
    openExternal: async (url: string) => window.open(url, '_blank', 'noopener,noreferrer')
  },
  notification: {
    send: async () => true,
    onClick: () => createCleanup()
  },
  system: {
    getDeviceType: async () => 'desktop',
    getHostname: async () => globalWindow.location.hostname || 'localhost',
    getCpuName: async () => navigator.userAgent,
    checkGitBash: async () => false,
    getGitBashPath: async () => null,
    getGitBashPathInfo: async () => ({ path: null, source: 'tauri', exists: false }),
    setGitBashPath: async () => false,
    listCaptureWindows: async () => {
      if (!invoke) return []
      return invoke('list_capture_windows')
    },
    captureWindow: async (windowId: number) => {
      if (!invoke) {
        throw new Error('Window capture is unavailable in preview mode')
      }
      return invoke('capture_window', { windowId })
    }
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
    onBroadcast: () => createCleanup(),
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
    cleanLocalData: noOpAsync,
    openWindow: noOpAsync,
    getData: async () => []
  },
  obsidian: {
    getVaults: async () => [],
    getFiles: async () => []
  },
  searchService: {
    openUrlInSearchWindow: async (_uid: string, url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
      return url
    },
    closeSearchWindow: noOpAsync
  },
  file: {
    select: async (options?: AnyRecord) =>
      pickFiles(Boolean(options?.properties?.includes?.('multiSelections')), options?.filters),
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
      if (!cached) {
        const stored = localStorage.getItem(`file:${fileId}`)
        return stored ?? (fileId === 'custom-minapps.json' ? '[]' : '')
      }
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
      const appInfo = await getAppInfo()
      return appInfo?.appDataPath || '/tmp'
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
    onProgress: (callback: (data: ProgressPayload) => void) => {
      backupProgressListeners.add(callback)
      return () => {
        backupProgressListeners.delete(callback)
      }
    },
    onRestoreProgress: (callback: (data: ProgressPayload) => void) => {
      restoreProgressListeners.add(callback)
      return () => {
        restoreProgressListeners.delete(callback)
      }
    },
    restore: async (filePath: string) => {
      const cached = await getCachedFile(filePath)
      if (!cached) return ''
      try {
        emitRestoreProgress({ stage: 'preparing', progress: 5, total: 100 })
        await waitForNextFrame()
        if (invoke && cached.fileName.toLowerCase().endsWith('.zip')) {
          emitRestoreProgress({ stage: 'extracting', progress: 35, total: 100 })
          const bytes = Array.from(await readBlobAsUint8Array(cached.blob))
          const result = await invoke('restore_backup_archive', { fileName: cached.fileName, bytes })
          emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
          return result
        }
        emitRestoreProgress({ stage: 'reading_data', progress: 70, total: 100 })
        const result = await readBlobAsText(cached.blob)
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        return result
      } catch (error) {
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    backup: async (fileName: string, destinationPath?: string, skipBackupFile: boolean = false) => {
      try {
        const snapshot = await buildBackupSnapshot()
        emitBackupProgress({ stage: 'writing_data', progress: 74, total: 100 })
        const payload = JSON.stringify(snapshot, null, 2)
        emitBackupProgress({ stage: 'compressing', progress: 88, total: 100 })
        if (invoke) {
          await invoke('backup_to_local_dir', {
            fileName,
            localBackupDir: destinationPath || null,
            payload,
            skipBackupFile
          })
          emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
          return true
        }
        const blob = new Blob([payload], { type: 'application/json' })
        downloadBlob(fileName.replace(/\.zip$/i, '.json'), blob)
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        return true
      } catch (error) {
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    backupToWebdav: async (webdavConfig: AnyRecord) => {
      try {
        const snapshot = await buildBackupSnapshot()
        emitBackupProgress({ stage: 'compressing', progress: 82, total: 100 })
        const config = mapWebdavConfig(webdavConfig)
        await invoke('webdav_backup', { state: snapshot, config })
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        return true
      } catch (error) {
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    restoreFromWebdav: async (webdavConfig: AnyRecord) => {
      try {
        emitRestoreProgress({ stage: 'preparing', progress: 5, total: 100 })
        const config = mapWebdavConfig(webdavConfig)
        emitRestoreProgress({ stage: 'extracting', progress: 40, total: 100 })
        const data = await invoke('webdav_restore', { config })
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        return JSON.stringify(data)
      } catch (error) {
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    listWebdavFiles: async (webdavConfig: AnyRecord) => {
      if (!invoke) return []
      const config = mapWebdavConfig(webdavConfig)
      const files = await invoke('list_webdav_files', { config })
      return files.map((file: AnyRecord) => ({
        fileName: file.fileName,
        modifiedTime: file.modifiedTime,
        size: file.size
      }))
    },
    checkConnection: async (webdavConfig: AnyRecord) => {
      if (invoke) {
        return invoke('check_webdav_connection', { config: mapWebdavConfig(webdavConfig) })
      }
      return Boolean(webdavConfig?.webdavHost)
    },
    createDirectory: async (webdavConfig: AnyRecord, targetPath: string, options?: AnyRecord) => {
      if (invoke) {
        return invoke('create_webdav_directory', { config: mapWebdavConfig(webdavConfig), path: targetPath, options })
      }
      return true
    },
    deleteWebdavFile: async (fileName: string, webdavConfig: AnyRecord) => {
      if (!invoke) return true
      const config = {
        url: `${String(webdavConfig.webdavHost || '').replace(/\/$/, '')}${webdavConfig.webdavPath || ''}`,
        username: webdavConfig.webdavUser || '',
        password: webdavConfig.webdavPass || '',
        fileName: webdavConfig.fileName || 'lich13studio-backup.zip'
      }
      return invoke('delete_webdav_file', { fileName, config })
    },
    backupToLocalDir: async (fileName: string, localConfig?: AnyRecord) => {
      try {
        const payload = JSON.stringify(await buildBackupSnapshot(), null, 2)
        emitBackupProgress({ stage: 'compressing', progress: 88, total: 100 })
        if (invoke) {
          await invoke('backup_to_local_dir', {
            fileName,
            localBackupDir: localConfig?.localBackupDir || null,
            payload,
            skipBackupFile: Boolean(localConfig?.skipBackupFile)
          })
          emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
          return true
        }
        const blob = new Blob([payload], { type: 'application/json' })
        downloadBlob(fileName.replace(/\.zip$/i, '.json'), blob)
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        return true
      } catch (error) {
        emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    restoreFromLocalBackup: async (fileName: string, localBackupDir?: string) => {
      if (!invoke) return undefined
      try {
        emitRestoreProgress({ stage: 'preparing', progress: 5, total: 100 })
        emitRestoreProgress({ stage: 'extracting', progress: 40, total: 100 })
        const result = await invoke('restore_from_local_backup', { fileName, localBackupDir: localBackupDir || null })
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        return result
      } catch (error) {
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
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
    checkWebdavConnection: async (webdavConfig: AnyRecord) => {
      if (invoke) {
        return invoke('check_webdav_connection', { config: mapWebdavConfig(webdavConfig) })
      }
      return Boolean(webdavConfig?.webdavHost)
    },
    createLanTransferBackup: async () => '',
    deleteLanTransferBackup: async () => true
  },
  protocol: {
    onReceiveData: (callback: (data: ProtocolPayload) => void) => {
      protocolListeners.add(callback)
      ensureDeepLinkListener()
      return () => {
        protocolListeners.delete(callback)
      }
    }
  },
  mcp: {
    listTools: async () => [],
    listPrompts: async () => [],
    listResources: async () => [],
    getServerVersion: async () => 'tauri-runtime',
    getServerLogs: async () => [],
    onServersChanged: () => createCleanup(),
    onServerAdded: () => createCleanup(),
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
      if (typeof prop === 'string' && prop.startsWith('on') && !(prop in target)) {
        return () => createCleanup()
      }
      if (prop in target) {
        return target[prop]
      }
      return fallbackCallable(`api.${String(prop)}`)
    }
  })
}

export {}
