import './tauriGlobals'
import './services/mobile/webviewCompatibility'

import { loggerService } from '@logger'
import { isMainProcessSettingKey } from '@renderer/hooks/settingsSync'
import {
  isPermissionGranted as isNotificationPermissionGranted,
  onAction as onNotificationAction,
  requestPermission as requestNotificationPermission
} from '@tauri-apps/plugin-notification'

import {
  credentialStorageEnabled,
  DESKTOP_RESET_NOTICE_STORAGE_KEY,
  hydrateCredentials,
  mobilePersistStorage,
  stripCredentials
} from './services/mobile/credentials'
import { mobileCommand, runtimeCapabilities, toBinaryIpcPayload } from './services/mobile/runtime'
import { attachmentMime, managedAttachmentId } from './utils/attachmentMime'

type AnyRecord = Record<string, any>
const WORD_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const logger = loggerService.withContext('TauriShim')
const STORE_SYNC_EVENT = 'store-sync'

const globalWindow = window as AnyRecord
globalWindow.__LICH13_TAURI_SHIM__ = true
const tauri = globalWindow.__TAURI__
const previewMode = new URL(window.location.href).searchParams.has('tauri-preview')
const storeSyncSourceId =
  globalWindow.crypto?.randomUUID?.() ?? `store-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`
const mockInvoke = async (command: string) => {
  if (command === 'app_info') {
    return {
      version: '0.1.0-preview',
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

  if (command === 'webdav_backup') {
    return true
  }

  return null
}
const invoke = tauri?.core?.invoke ?? (previewMode ? mockInvoke : undefined)

const isTauriRuntime = typeof invoke === 'function'
const isExternalUrl = (value: string) => /^(?:https?:|mailto:|tel:)/i.test(value.trim())
const notificationClickCallbacks = new Set<(notification: AnyRecord) => void>()
const openExternalUrl = async (url: string) => {
  const normalizedUrl = url.trim()
  if (!normalizedUrl) {
    return false
  }

  if (invoke) {
    return invoke('open_external_url', { url: normalizedUrl })
  }

  throw new Error('External URL opening is unavailable outside the Tauri runtime')
}

const handleNotificationClick = async (notification: AnyRecord) => {
  const payload = notification?.notification || notification
  const url = payload?.extra?.url

  if (typeof url === 'string' && url.trim()) {
    try {
      await openExternalUrl(url)
    } catch (error) {
      logger.error('Failed to open notification URL', error as Error)
    }
  }

  notificationClickCallbacks.forEach((callback) => callback(payload))
}

if (isTauriRuntime) {
  void onNotificationAction(handleNotificationClick).catch((error) => {
    logger.warn('Failed to register Tauri notification action listener', error as Error)
  })
}

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
  const log = (level: 'debug' | 'warn' | 'error', payload: any) => logger[level]('Toast fallback', payload)
  globalWindow.toast = {
    getToastQueue: () => [],
    addToast: () => undefined,
    closeToast: () => undefined,
    closeAll: () => undefined,
    isToastClosing: () => false,
    error: (payload: any) => log('error', payload),
    success: (payload: any) => log('debug', payload),
    warning: (payload: any) => log('warn', payload),
    info: (payload: any) => log('debug', payload),
    loading: (payload: any) => log('debug', payload)
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

const platform = runtimeCapabilities.android
  ? 'android'
  : navigator.userAgent.includes('Mac')
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

type CachedFileEntry = { fileName: string; ext: string; blob: Blob; text?: string }
const MAX_FILE_CACHE_ENTRIES = 64
const MAX_FILE_CACHE_BYTES = 64 * 1024 * 1024
const fileCache = new Map<string, CachedFileEntry>()
const fileAliasMap = new Map<string, string>()
let fileCacheTotalBytes = 0
const fileObjectMap = new WeakMap<File, string>()
const pendingFileRegistrations = new Map<string, Promise<AnyRecord>>()
let cachedAppInfo: AnyRecord | null = null

const deleteCachedFileEntry = (key: string) => {
  const canonicalKey = fileAliasMap.get(key) ?? key
  fileAliasMap.delete(key)
  for (const [alias, target] of fileAliasMap.entries()) {
    if (target === canonicalKey) {
      fileAliasMap.delete(alias)
    }
  }
  const existing = fileCache.get(canonicalKey)
  if (!existing) return
  fileCache.delete(canonicalKey)
  fileCacheTotalBytes = Math.max(0, fileCacheTotalBytes - existing.blob.size)
}

const clearFileCache = () => {
  fileCache.clear()
  fileAliasMap.clear()
  fileCacheTotalBytes = 0
}

const touchCachedFileEntry = (key: string): CachedFileEntry | undefined => {
  const canonicalKey = fileAliasMap.get(key) ?? key
  const entry = fileCache.get(canonicalKey)
  if (!entry) return undefined
  fileCache.delete(canonicalKey)
  fileCache.set(canonicalKey, entry)
  return entry
}

const setCachedFileEntry = (key: string, entry: CachedFileEntry) => {
  deleteCachedFileEntry(key)
  if (entry.blob.size > MAX_FILE_CACHE_BYTES && !key.startsWith('memory://')) {
    return
  }
  while (
    fileCache.size >= MAX_FILE_CACHE_ENTRIES ||
    (fileCache.size > 0 && fileCacheTotalBytes + entry.blob.size > MAX_FILE_CACHE_BYTES)
  ) {
    const oldestKey = fileCache.keys().next().value
    if (oldestKey === undefined) break
    deleteCachedFileEntry(oldestKey)
  }
  fileCache.set(key, entry)
  fileCacheTotalBytes += entry.blob.size
}
type ProgressPayload = {
  stage: string
  progress: number
  total: number
}

const backupProgressListeners = new Set<(data: ProgressPayload) => void>()
const restoreProgressListeners = new Set<(data: ProgressPayload) => void>()

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const createCleanup = () => () => {}

const normalizeExt = (fileName: string) => {
  const match = /\.([^.]+)$/.exec(fileName)
  return match ? `.${match[1]}` : ''
}

const normalizeImageExtension = (extension?: string) => {
  const cleanExtension = extension?.trim().replace(/^\.+/, '') || 'png'
  return cleanExtension.toLowerCase()
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
      logger.error('Progress listener failed', error as Error)
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
    if (!key || key === DESKTOP_RESET_NOTICE_STORAGE_KEY) continue
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
  let db: IDBDatabase | null = null
  try {
    db = await openAppIndexedDb()
    if (!db) {
      return {}
    }

    const activeDb = db
    const snapshot: Record<string, any[]> = {}
    const storeNames = Array.from(activeDb.objectStoreNames)

    for (const storeName of storeNames) {
      const rows = await new Promise<any[]>((resolve, reject) => {
        const transaction = activeDb.transaction([storeName], 'readonly')
        const request = transaction.objectStore(storeName).getAll()
        request.onerror = () => reject(request.error || new Error(`Failed to read ${storeName}`))
        request.onsuccess = () => resolve(request.result || [])
      })
      snapshot[storeName] =
        storeName === 'settings' ? rows.filter((entry) => entry?.id !== 'backup:committed-restore-id') : rows
      onProgress?.((snapshot[storeName] ? Object.keys(snapshot).length : 0) / Math.max(storeNames.length, 1))
      await waitForNextFrame()
    }

    return snapshot
  } catch (error) {
    logger.warn('Failed to serialize IndexedDB backup snapshot', error as Error)
    throw new Error('Could not read database for backup')
  } finally {
    db?.close()
  }
}

export const buildBackupSnapshot = async (includeCredentials = false) => {
  const { persistor } = await import('@renderer/store')
  await persistor.flush()
  emitBackupProgress({ stage: 'preparing', progress: 5, total: 100 })
  await waitForNextFrame()

  const localStorageSnapshot = includeCredentials
    ? hydrateCredentials(serializeLocalStorage())
    : stripCredentials(serializeLocalStorage())
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
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mime = attachmentMime(fileName, blob.type, bytes)
  if (blob.type !== mime) blob = new Blob([bytes], { type: mime })
  const id = (explicitPath && managedAttachmentId(explicitPath, ext)) || createId('file')
  let cacheKey = explicitPath || `memory://${id}/${fileName}`
  if (invoke && !explicitPath) {
    const path = await invoke('persist_attachment', toBinaryIpcPayload(bytes, runtimeCapabilities.android), {
      headers: { 'x-file-name': encodeURIComponent(`${id}${ext}`) }
    })
    if (typeof path === 'string') cacheKey = path
  }
  setCachedFileEntry(cacheKey, { fileName, ext, blob })
  const aliasKey = `${id}${ext}`
  if (aliasKey !== cacheKey && fileCache.has(cacheKey)) {
    fileAliasMap.set(aliasKey, cacheKey)
  }

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

const toUint8Array = (raw: unknown): Uint8Array => {
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  if (Array.isArray(raw)) return new Uint8Array(raw)
  return new Uint8Array()
}

const getCachedFile = async (fileIdOrPath: string) => {
  const direct = touchCachedFileEntry(fileIdOrPath)
  if (direct) {
    return direct
  }
  for (const [key] of fileCache.entries()) {
    if (key.endsWith(`/${fileIdOrPath}`) || key.endsWith(`\\${fileIdOrPath}`)) {
      return touchCachedFileEntry(key)
    }
  }
  if (invoke && fileIdOrPath && !/^(?:https?:|memory:)/i.test(fileIdOrPath)) {
    try {
      const rawBytes = await invoke('read_attachment', { name: fileIdOrPath })
      const byteArray = toUint8Array(rawBytes)
      const fileName = fileIdOrPath.replace(/\\/g, '/').split('/').pop() || fileIdOrPath
      const ext = normalizeExt(fileName)
      const mime = attachmentMime(fileName, '', byteArray)
      const cached = {
        fileName,
        ext,
        blob: new Blob([toBlobPart(byteArray)], { type: mime }),
        text: undefined as string | undefined
      }
      setCachedFileEntry(fileIdOrPath, cached)
      return cached
    } catch {
      return undefined
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

const extensionFromMimeType = (mimeType?: string) => {
  switch ((mimeType || '').trim().toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/bmp':
      return '.bmp'
    case 'image/svg+xml':
      return '.svg'
    case 'image/png':
    default:
      return '.png'
  }
}

const decodeBase64ToBytes = (payload: string) => {
  const normalized = payload.replace(/\s/g, '')
  if (!normalized) {
    throw new Error('Base64 data is required')
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const imageDataToBlob = (data: string) => {
  const trimmed = data.trim()
  if (!trimmed) {
    throw new Error('Base64 data is required')
  }

  if (/^data:/i.test(trimmed)) {
    const commaIndex = trimmed.indexOf(',')
    if (commaIndex === -1) {
      throw new Error('Invalid base64 image data URL')
    }

    const header = trimmed.slice(5, commaIndex)
    if (!header.split(';').some((part) => part.toLowerCase() === 'base64')) {
      throw new Error('Only base64 image data URLs are supported')
    }

    const mimeType = header.split(';')[0]?.trim() || 'image/png'
    const bytes = decodeBase64ToBytes(trimmed.slice(commaIndex + 1))
    return {
      blob: new Blob([toBlobPart(bytes)], { type: mimeType }),
      extension: extensionFromMimeType(mimeType)
    }
  }

  const bytes = decodeBase64ToBytes(trimmed)
  return {
    blob: new Blob([toBlobPart(bytes)], { type: 'image/png' }),
    extension: '.png'
  }
}

const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const saveBlob = async (fileName: string, blob: Blob) => {
  if (invoke) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const savedPath = await invoke('save_file', toBinaryIpcPayload(bytes, runtimeCapabilities.android), {
        headers: { 'x-file-name': encodeURIComponent(fileName) }
      })
      return typeof savedPath === 'string' ? savedPath.trim().length > 0 : Boolean(savedPath)
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) {
        return false
      }
      throw error
    }
  }

  downloadBlob(fileName, blob)
  return true
}

const pickFiles = async (multiple = true, filters?: Array<{ name: string; extensions: string[] }>, persist = true) =>
  new Promise<any[] | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    const accepted = filters?.flatMap((filter) => filter.extensions.map((extension) => `.${extension}`)).join(',')
    // Android SAF cannot map the custom encrypted-backup extension to a MIME type.
    // Backup format/authentication is validated after selection.
    if (accepted) input.accept = runtimeCapabilities.android && !persist ? '*/*' : accepted
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      if (files.length === 0) {
        resolve(null)
        return
      }
      const metas = await Promise.all(
        files.map(async (file) => {
          // A backup must never be copied into the attachments included in the next backup.
          const path = persist
            ? await registerBrowserFile(file)
            : (await registerBlob(file, file.name, `memory://${createId('backup')}/${file.name}`)).path
          const meta = await getCachedFile(path)
          const ext = normalizeExt(file.name)
          const content = persist ? undefined : new Uint8Array(await file.arrayBuffer())
          return {
            id: managedAttachmentId(path, ext) || createId('file'),
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
            ...(content ? { content } : {})
          }
        })
      )
      resolve(metas)
    }
    input.click()
  })

const computeCacheSizeBytes = () => {
  let bytes = 0

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

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const getAppInfo = async () => {
  if (cachedAppInfo) {
    return cachedAppInfo
  }
  cachedAppInfo = await invoke('app_info')
  return cachedAppInfo
}

const QUOTE_TO_MAIN_EVENT = 'lich13:quote-to-main-window'

const noOpAsync = async (...args: any[]) => {
  void args
  return undefined
}

const api = {
  getAppInfo,
  notifyReduxStoreReady: noOpAsync,
  reload: async () => location.reload(),
  setLaunchOnBoot: async (enabled: boolean) => {
    if (invoke) {
      return invoke('set_launch_on_boot', { enabled })
    }
    return undefined
  },
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
  relaunchApp: async () => {
    if (!previewMode && invoke && !runtimeCapabilities.android) {
      await invoke('close_mini_window').catch(() => {})
    }
    location.reload()
  },
  resetData: async () => {
    clearFileCache()
    pendingFileRegistrations.clear()
    cachedAppInfo = null
    if (!previewMode && invoke) {
      if (!runtimeCapabilities.android) {
        await invoke('close_mini_window').catch(() => {})
      }
      await invoke('clear_attachments')
    }
    if (credentialStorageEnabled) await mobilePersistStorage.removeItem('persist:cherry-studio')
    localStorage.clear()
    location.reload()
  },
  openPath: async (url: string) => {
    if (invoke) {
      if (isExternalUrl(url)) {
        return openExternalUrl(url)
      }
      return invoke('open_path', { path: url })
    }
    throw new Error('Path opening is unavailable outside the Tauri runtime')
  },
  getCacheSize: async () => formatBytes(computeCacheSizeBytes()),
  clearCache: async () => {
    clearFileCache()
  },
  onSaveData: () => createCleanup(),
  quoteToMainWindow: async (text: string) => {
    if (tauri?.event?.emit) {
      await tauri.event.emit(QUOTE_TO_MAIN_EVENT, text)
    }
  },
  onQuoteToMainWindow: (callback: (text: string) => void) => {
    if (tauri?.event?.listen) {
      let cleanup = createCleanup()
      void tauri.event
        .listen(QUOTE_TO_MAIN_EVENT, (event: { payload?: string }) => {
          if (typeof event.payload === 'string') {
            callback(event.payload)
          }
        })
        .then((unlisten: () => void) => {
          cleanup = unlisten
        })
      return () => cleanup()
    }
    return createCleanup()
  },
  onThemeUpdated: (callback: (theme: 'light' | 'dark') => void) => {
    themeListeners.add(callback)
    callback(emitThemeUpdated())
    return () => {
      themeListeners.delete(callback)
    }
  },
  onFullScreenStatusChanged: (callback: (isFullScreen: boolean) => void) => {
    const handler = () => callback(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
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
  shell: {
    openExternal: openExternalUrl
  },
  notification: {
    send: async (notification: AnyRecord) => {
      const title = String(notification?.title || '').trim()
      const message = String(notification?.message || '').trim()

      if (!isTauriRuntime) {
        return true
      }

      if (!title && !message) {
        return false
      }

      let permissionGranted = false

      try {
        permissionGranted = runtimeCapabilities.android
          ? (await mobileCommand<{ granted: boolean }>('notificationPermission')).granted
          : await isNotificationPermissionGranted()
      } catch {
        permissionGranted = window.Notification?.permission === 'granted'
      }

      if (!permissionGranted && !runtimeCapabilities.android) {
        try {
          permissionGranted = (await requestNotificationPermission()) === 'granted'
        } catch {
          permissionGranted = false
        }
      }

      if (!permissionGranted) {
        return false
      }

      const systemNotification = new window.Notification(title || 'lich13studio', {
        body: message,
        data: notification,
        silent: Boolean(notification?.silent),
        tag: notification?.id ? String(notification.id) : undefined
      })

      systemNotification.onclick = () => {
        void handleNotificationClick(notification)
      }

      return true
    },
    onClick: (callback: (notification: AnyRecord) => void) => {
      notificationClickCallbacks.add(callback)
      return () => {
        notificationClickCallbacks.delete(callback)
      }
    }
  },
  system: {
    getDeviceType: async () => {
      if (invoke) {
        return invoke('get_device_type')
      }
      return 'desktop'
    },
    getHostname: async () => {
      if (invoke) {
        return invoke('get_hostname')
      }
      return globalWindow.location.hostname || 'localhost'
    },
    listCaptureWindows: async () => {
      if (!invoke) return []
      return invoke('list_capture_windows')
    },
    captureWindow: async (windowId: number) => {
      if (!invoke) {
        throw new Error('Window capture is unavailable in preview mode')
      }
      return toUint8Array(await invoke('capture_window', { windowId }))
    }
  },
  devTools: {
    toggle: async () => undefined
  },
  zip: {
    decompress: async (input: Uint8Array | ArrayBuffer | string) => {
      if (typeof input === 'string') return input
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
      if (
        bytes.byteLength >= 2 &&
        bytes[0] === 0x1f &&
        bytes[1] === 0x8b &&
        typeof DecompressionStream === 'function'
      ) {
        const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
        return await new Response(stream).text()
      }
      return new TextDecoder().decode(bytes)
    }
  },
  storeSync: {
    onUpdate: async (action: AnyRecord) => {
      if (!tauri?.event?.emit) return
      await tauri.event.emit(STORE_SYNC_EVENT, { sourceId: storeSyncSourceId, action })
    },
    onBroadcast: (callback: (action: AnyRecord) => void) => {
      let cleanup = createCleanup()
      if (tauri?.event?.listen) {
        void tauri.event
          .listen(STORE_SYNC_EVENT, (event: { payload?: { sourceId?: string; action?: AnyRecord } }) => {
            const payload = event.payload
            if (!payload?.action || payload.sourceId === storeSyncSourceId) return
            callback({
              ...payload.action,
              meta: {
                ...payload.action.meta,
                fromSync: true,
                source: `tauri:${payload.sourceId || 'unknown'}`
              }
            })
          })
          .then((unlisten: () => void) => {
            cleanup = unlisten
          })
      }
      return () => cleanup()
    },
    subscribe: noOpAsync,
    unsubscribe: noOpAsync
  },
  window: {
    setMinimumSize: noOpAsync,
    resetMinimumSize: noOpAsync
  },
  miniWindow: {
    show: async () => {
      if (invoke) return invoke('show_mini_window')
    },
    hide: async () => {
      if (invoke) return invoke('hide_mini_window')
    },
    close: async () => {
      if (invoke) return invoke('close_mini_window')
    },
    toggle: async () => {
      if (invoke) return invoke('toggle_mini_window')
    },
    setPin: async (isPinned: boolean) => {
      if (invoke) return invoke('set_mini_window_pin', { isPinned })
    },
    onShow: (callback: () => void) => {
      if (tauri?.event?.listen) {
        let cleanup = createCleanup()
        void tauri.event.listen('show-mini-window', callback).then((unlisten: () => void) => {
          cleanup = unlisten
        })
        return () => cleanup()
      }
      return createCleanup()
    }
  },
  config: {
    set: async (key: string, value: any, _sync?: boolean) => {
      void _sync
      if (invoke && typeof value === 'boolean' && isMainProcessSettingKey(key)) {
        await invoke('set_runtime_setting', { key, value })
      }
    },
    get: async () => null
  },
  export: {
    toWord: async (markdown: string, fileName: string) => {
      const [{ Document, Packer, Paragraph }, { markdownToPlainText }] = await Promise.all([
        import('docx'),
        import('@renderer/utils/markdown')
      ])

      const plainText = markdownToPlainText(markdown)
      const paragraphs = plainText
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => new Paragraph({ text: block }))

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })]
          }
        ]
      })

      const blob = await Packer.toBlob(doc)
      const targetName = fileName.toLowerCase().endsWith('.docx') ? fileName : `${fileName}.docx`
      return saveBlob(targetName, new Blob([blob], { type: WORD_DOCX_MIME }))
    }
  },
  obsidian: {
    getVaults: async () => {
      if (!invoke) return []
      return invoke('get_obsidian_vaults')
    },
    getFiles: async (vaultName: string) => {
      if (!invoke) return []
      return invoke('get_obsidian_files', { vaultName })
    }
  },
  file: {
    select: async (options?: AnyRecord) =>
      pickFiles(Boolean(options?.properties?.includes?.('multiSelections')), options?.filters),
    open: async (options?: AnyRecord) => {
      const files = await pickFiles(false, options?.filters, false)
      return files?.[0] || null
    },
    upload: async (file: AnyRecord) => file,
    delete: async (fileId: string) => {
      deleteCachedFileEntry(fileId)
      for (const key of Array.from(fileCache.keys())) {
        if (key.endsWith(`/${fileId}`) || key.endsWith(`\\${fileId}`)) {
          deleteCachedFileEntry(key)
        }
      }
      if (!previewMode && invoke && fileId && !/^(?:https?:|memory:)/i.test(fileId)) {
        await invoke('delete_attachment', { name: fileId })
      }
      return true
    },
    read: async (fileId: string, forceTextExtract?: boolean) => {
      const cached = await getCachedFile(fileId)
      if (!cached) {
        return ''
      }
      if (forceTextExtract && /\.pdf$/i.test(cached.fileName || fileId)) {
        const { extractPdfText } = await import('@shared/utils/pdf')
        cached.text = cached.text ?? (await extractPdfText(await readBlobAsUint8Array(cached.blob)))
        return cached.text
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
    get: async (filePath: string) => {
      const pending = pendingFileRegistrations.get(filePath)
      if (pending) return pending
      const cached = await getCachedFile(filePath)
      if (!cached) return null
      const meta = await registerBlob(cached.blob, cached.fileName, filePath)
      return meta
    },
    createTempFile: async (fileName: string) => {
      const path = `memory://temp/${createId('tmp')}/${fileName}`
      setCachedFileEntry(path, { fileName, ext: normalizeExt(fileName), blob: new Blob([]), text: '' })
      return path
    },
    write: async (filePath: string, data: Uint8Array | string) => {
      const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : new Blob([toBlobPart(data)])
      const current = fileCache.get(filePath)
      setCachedFileEntry(filePath, {
        fileName: current?.fileName || filePath.split('/').pop() || 'file.txt',
        ext: current?.ext || normalizeExt(filePath),
        blob
      })
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
    save: async (name: string, content: string | Uint8Array) => {
      const blob =
        typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : new Blob([toBlobPart(content)])
      return saveBlob(name, blob)
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
      return saveBlob(`${name}.png`, blob)
    },
    binaryImage: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) {
        return { mime: 'application/octet-stream', data: new Uint8Array() }
      }
      return {
        mime: cached.blob.type || 'application/octet-stream',
        data: await readBlobAsUint8Array(cached.blob)
      }
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
      if (!previewMode && invoke) {
        return invoke('save_base64_image', { data })
      }

      const { blob, extension } = imageDataToBlob(data)
      return registerBlob(blob, `image-${Date.now()}${extension}`)
    },
    savePastedImage: async (imageData: Uint8Array, extension = 'png') => {
      const cleanExtension = normalizeImageExtension(extension)
      const mimeExtension = cleanExtension === 'jpg' ? 'jpeg' : cleanExtension
      const fileName = `pasted-${Date.now()}.${cleanExtension}`
      const blob = new Blob([toBlobPart(imageData)], { type: `image/${mimeExtension}` })
      return registerBlob(blob, fileName)
    },
    base64File: async (fileId: string) => {
      const cached = await getCachedFile(fileId)
      if (!cached) {
        return { mime: 'application/octet-stream', base64: '', data: '' }
      }
      const dataUrl = await readBlobAsDataUrl(cached.blob)
      const base64 = dataUrl.split(',')[1] || ''
      return {
        mime: cached.blob.type || 'application/octet-stream',
        base64,
        data: base64
      }
    },
    getPathForFile: (file: File) => {
      const existing = fileObjectMap.get(file)
      if (existing) return existing
      const pseudoPath = `memory://${createId('file')}/${file.name}`
      fileObjectMap.set(file, pseudoPath)
      const registration = registerBlob(file, file.name)
        .then((meta) => {
          fileObjectMap.set(file, meta.path)
          return meta
        })
        .finally(() => {
          pendingFileRegistrations.delete(pseudoPath)
        })
      pendingFileRegistrations.set(pseudoPath, registration)
      void registration.catch(() => {}) // The awaiting file.get caller handles the error.
      return pseudoPath
    },
    isTextFile: async (filePath: string) => /\.(txt|md|markdown|json|js|ts|tsx|jsx|html|css|csv)$/i.test(filePath)
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
        if (invoke && /\.(zip|lich13backup)$/i.test(cached.fileName)) {
          emitRestoreProgress({ stage: 'extracting', progress: 35, total: 100 })
          const bytes = await readBlobAsUint8Array(cached.blob)
          if (cached.fileName.toLowerCase().endsWith('.lich13backup')) {
            const { decryptPortableBackup } = await import('./services/PortableBackupService')
            const restored = await decryptPortableBackup(bytes)
            if (!restored) throw new DOMException('Request was aborted', 'AbortError')
            emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
            return restored
          }
          const result = await invoke(
            'restore_backup_archive',
            toBinaryIpcPayload(bytes, runtimeCapabilities.android),
            {
              headers: { 'x-file-name': encodeURIComponent(cached.fileName) }
            }
          )
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
      } finally {
        deleteCachedFileEntry(filePath)
        deleteCachedFileEntry(`${managedAttachmentId(filePath, cached.ext)}${cached.ext}`)
      }
    },
    backup: async (fileName: string, destinationPath?: string, skipBackupFile: boolean = false) => {
      try {
        const snapshot = await buildBackupSnapshot()
        emitBackupProgress({ stage: 'compressing', progress: 84, total: 100 })
        if (invoke) {
          await invoke('backup_to_local_dir', {
            fileName,
            localBackupDir: destinationPath || null,
            state: snapshot,
            skipBackupFile
          })
          emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
          return true
        }
        const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
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
        if (data === undefined || data === null) {
          return undefined
        }
        if (typeof data === 'object' && typeof (data as AnyRecord).payload === 'string') {
          return {
            payload: (data as AnyRecord).payload,
            restoreId: typeof (data as AnyRecord).restoreId === 'string' ? (data as AnyRecord).restoreId : null
          }
        }
        return typeof data === 'string' ? data : JSON.stringify(data)
      } catch (error) {
        emitRestoreProgress({ stage: 'completed', progress: 100, total: 100 })
        throw error
      }
    },
    listWebdavFiles: async (webdavConfig: AnyRecord) => {
      if (!invoke) return []
      const config = mapWebdavConfig(webdavConfig)
      const files = await invoke('list_webdav_files', { config })
      return files
        .map((file: AnyRecord) => ({
          fileName: file.fileName,
          modifiedTime: file.modifiedTime,
          size: file.size
        }))
        .sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
    },
    deleteWebdavFile: async (fileName: string, webdavConfig: AnyRecord) => {
      if (!invoke) return true
      const config = mapWebdavConfig(webdavConfig)
      return invoke('delete_webdav_file', { fileName, config })
    },
    backupToLocalDir: async (fileName: string, localConfig?: AnyRecord) => {
      try {
        const snapshot = await buildBackupSnapshot()
        emitBackupProgress({ stage: 'compressing', progress: 88, total: 100 })
        if (invoke) {
          await invoke('backup_to_local_dir', {
            fileName,
            localBackupDir: localConfig?.localBackupDir || null,
            state: snapshot,
            skipBackupFile: Boolean(localConfig?.skipBackupFile)
          })
          emitBackupProgress({ stage: 'completed', progress: 100, total: 100 })
          return true
        }
        const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
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
        let password: string | null = null
        if (fileName.toLowerCase().endsWith('.lich13backup')) {
          const { requestBackupPassword } = await import('./components/Popups/BackupPasswordPopup')
          password = await requestBackupPassword()
          if (password === null) {
            throw new DOMException('Request was aborted', 'AbortError')
          }
        }
        emitRestoreProgress({ stage: 'extracting', progress: 40, total: 100 })
        const result = await invoke('restore_from_local_backup', {
          fileName,
          localBackupDir: localBackupDir || null,
          password
        })
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
    }
  }
}

export type TauriShimApi = typeof api

if (isTauriRuntime) {
  globalWindow.api = api
}

for (const key of ['config:mcpServers', 'config:mcp', 'mcpServers', 'mcp', 'tauri:app-data-path']) {
  localStorage.removeItem(key)
}
