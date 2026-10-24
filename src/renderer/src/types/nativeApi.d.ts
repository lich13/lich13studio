import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { GitBashPathInfo, TerminalConfig, UpgradeChannel } from '@shared/config/constant'
import type { LogLevel, LogSourceWithContext } from '@shared/config/logger'
import type { CodeToolsRunResult, FileChangeEvent, OperationResult } from '@shared/config/types'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import type { SpanEntity, TokenUsage } from '@trace/trace-core'
import type { Notification } from '@types'
import type {
  FileListResponse,
  FileMetadata,
  FileUploadResponse,
  GetApiServerStatusResult,
  Model,
  OcrProvider,
  OcrResult,
  Provider,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult,
  SupportedOcrFile,
  ThemeMode,
  WebDavConfig
} from '@types'
import type { CreateDirectoryOptions } from 'webdav'

import type { OpenDialogOptions } from './fileDialog'
import type {
  InstalledSkill,
  LocalSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillResult,
  SkillToggleOptions
} from './skill'
type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'
interface OpenClawHealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
}
interface OpenClawChannelInfo {
  id: string
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
}
type DirectoryListOptions = {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}
declare const api: {
  getAppInfo: () => Promise<any>
  getDiskInfo: (directoryPath: string) => Promise<{
    free: number
    size: number
  } | null>
  reload: () => Promise<any>
  quit: () => Promise<any>
  setProxy: (proxy: string | undefined, bypassRules?: string) => Promise<any>
  setLanguage: (lang: string) => Promise<any>
  setLaunchOnBoot: (isActive: boolean) => Promise<any>
  setTestPlan: (isActive: boolean) => Promise<any>
  setTestChannel: (channel: UpgradeChannel) => Promise<any>
  setTheme: (theme: ThemeMode) => Promise<any>
  handleZoomFactor: (delta: number, reset?: boolean) => Promise<any>
  setAutoUpdate: (isActive: boolean) => Promise<any>
  select: (options: OpenDialogOptions) => Promise<any>
  hasWritePermission: (path: string) => Promise<any>
  resolvePath: (path: string) => Promise<any>
  isPathInside: (childPath: string, parentPath: string) => Promise<any>
  setAppDataPath: (path: string) => Promise<any>
  getDataPathFromArgs: () => Promise<any>
  copy: (oldPath: string, newPath: string, occupiedDirs?: string[]) => Promise<any>
  setStopQuitApp: (stop: boolean, reason: string) => Promise<any>
  flushAppData: () => Promise<any>
  isNotEmptyDir: (path: string) => Promise<any>
  relaunchApp: (options?: { args?: string[]; execPath?: string }) => Promise<any>
  resetData: () => Promise<any>
  openWebsite: (url: string) => Promise<any>
  getCacheSize: () => Promise<any>
  clearCache: () => Promise<any>
  logToMain: (source: LogSourceWithContext, level: LogLevel, message: string, data: any[]) => Promise<any>
  setFullScreen: (value: boolean) => Promise<void>
  isFullScreen: () => Promise<boolean>
  getSystemFonts: () => Promise<string[]>
  getIpCountry: () => Promise<string>
  mockCrashRenderProcess: () => Promise<any>
  notifyReduxStoreReady: () => Promise<any>
  onSaveData: (callback: () => void) => () => void
  onThemeUpdated: (callback: (theme: ThemeMode) => void) => () => void
  onFullScreenStatusChanged: (callback: (isFullscreen: boolean) => void) => () => void
  mac: {
    isProcessTrusted: () => Promise<boolean>
    requestProcessTrust: () => Promise<boolean>
  }
  notification: {
    send: (notification: Notification) => Promise<any>
    onClick: (callback: (notification: Notification) => void) => () => void
  }
  system: {
    getDeviceType: () => Promise<any>
    getHostname: () => Promise<any>
    getCpuName: () => Promise<any>
    checkGitBash: () => Promise<boolean>
    getGitBashPath: () => Promise<string | null>
    getGitBashPathInfo: () => Promise<GitBashPathInfo>
    setGitBashPath: (newPath: string | null) => Promise<boolean>
    listCaptureWindows: () => Promise<
      Array<{
        id: number
        appName: string
        title: string
        width: number
        height: number
        isFocused: boolean
      }>
    >
    captureWindow: (windowId: number) => Promise<number[]>
  }
  devTools: {
    toggle: () => Promise<any>
  }
  zip: {
    compress: (text: string) => Promise<any>
    decompress: (text: Buffer) => Promise<any>
  }
  backup: {
    restore: (path: string) => Promise<any>
    backup: (fileName: string, destinationPath: string, skipBackupFile: boolean) => Promise<any>
    backupToWebdav: (webdavConfig: WebDavConfig) => Promise<any>
    restoreFromWebdav: (webdavConfig: WebDavConfig) => Promise<any>
    listWebdavFiles: (webdavConfig: WebDavConfig) => Promise<any>
    checkConnection: (webdavConfig: WebDavConfig) => Promise<any>
    createDirectory: (webdavConfig: WebDavConfig, path: string, options?: CreateDirectoryOptions) => Promise<any>
    deleteWebdavFile: (fileName: string, webdavConfig: WebDavConfig) => Promise<any>
    backupToLocalDir: (
      fileName: string,
      localConfig: {
        localBackupDir?: string
        skipBackupFile?: boolean
      }
    ) => Promise<any>
    restoreFromLocalBackup: (fileName: string, localBackupDir?: string) => Promise<any>
    listLocalBackupFiles: (localBackupDir?: string) => Promise<any>
    deleteLocalBackupFile: (fileName: string, localBackupDir?: string) => Promise<any>
    checkWebdavConnection: (webdavConfig: WebDavConfig) => Promise<any>
    onProgress: (callback: (data: { stage: string; progress: number; total: number }) => void) => () => void
    onRestoreProgress: (callback: (data: { stage: string; progress: number; total: number }) => void) => () => void
  }
  file: {
    select: (options?: OpenDialogOptions) => Promise<FileMetadata[] | null>
    upload: (file: FileMetadata) => Promise<any>
    delete: (fileId: string) => Promise<any>
    deleteDir: (dirPath: string) => Promise<any>
    deleteExternalFile: (filePath: string) => Promise<any>
    deleteExternalDir: (dirPath: string) => Promise<any>
    move: (path: string, newPath: string) => Promise<any>
    moveDir: (dirPath: string, newDirPath: string) => Promise<any>
    rename: (path: string, newName: string) => Promise<any>
    renameDir: (dirPath: string, newName: string) => Promise<any>
    read: (fileId: string, detectEncoding?: boolean) => Promise<any>
    readExternal: (filePath: string, detectEncoding?: boolean) => Promise<any>
    clear: (spanContext?: SpanContext) => Promise<any>
    get: (filePath: string) => Promise<FileMetadata | null>
    createTempFile: (fileName: string) => Promise<string>
    mkdir: (dirPath: string) => Promise<any>
    write: (filePath: string, data: Uint8Array | string) => Promise<any>
    writeWithId: (id: string, content: string) => Promise<any>
    open: (options?: OpenDialogOptions) => Promise<any>
    openPath: (path: string) => Promise<any>
    save: (path: string, content: string | NodeJS.ArrayBufferView, options?: any) => Promise<any>
    selectFolder: (options?: OpenDialogOptions) => Promise<string | null>
    saveImage: (name: string, data: string) => Promise<boolean>
    binaryImage: (fileId: string) => Promise<any>
    base64Image: (fileId: string) => Promise<{
      mime: string
      base64: string
      data: string
    }>
    saveBase64Image: (data: string) => Promise<any>
    savePastedImage: (imageData: Uint8Array, extension?: string) => Promise<any>
    download: (url: string, isUseContentType?: boolean) => Promise<any>
    copy: (fileId: string, destPath: string) => Promise<any>
    base64File: (fileId: string) => Promise<any>
    pdfInfo: (fileId: string) => Promise<any>
    getPathForFile: (file: File) => string
    openFileWithRelativePath: (file: FileMetadata) => Promise<any>
    isTextFile: (filePath: string) => Promise<boolean>
    isDirectory: (filePath: string) => Promise<boolean>
    getDirectoryStructure: (dirPath: string) => Promise<any>
    listDirectory: (dirPath: string, options?: DirectoryListOptions) => Promise<any>
    checkFileName: (dirPath: string, fileName: string, isFile: boolean) => Promise<any>
    validateNotesDirectory: (dirPath: string) => Promise<any>
    startFileWatcher: (dirPath: string, config?: any) => Promise<any>
    stopFileWatcher: () => Promise<any>
    pauseFileWatcher: () => Promise<any>
    resumeFileWatcher: () => Promise<any>
    batchUploadMarkdown: (filePaths: string[], targetPath: string) => Promise<any>
    onFileChange: (callback: (data: FileChangeEvent) => void) => () => void
    showInFolder: (path: string) => Promise<void>
  }
  fs: {
    read: (pathOrUrl: string, encoding?: BufferEncoding) => Promise<any>
    readText: (pathOrUrl: string) => Promise<string>
  }
  pdf: {
    extractText: (data: Uint8Array | ArrayBuffer | string) => Promise<string>
  }
  export: {
    toWord: (markdown: string, fileName: string) => Promise<any>
  }
  obsidian: {
    getVaults: () => Promise<any>
    getFolders: (vaultName: string) => Promise<any>
    getFiles: (vaultName: string) => Promise<any>
  }
  openPath: (path: string) => Promise<any>
  window: {
    setMinimumSize: (width: number, height: number) => Promise<any>
    resetMinimumSize: () => Promise<any>
    getSize: () => Promise<[number, number]>
    onResize: (callback: (size: [number, number]) => void) => () => void
  }
  fileService: {
    upload: (provider: Provider, file: FileMetadata) => Promise<FileUploadResponse>
    list: (provider: Provider) => Promise<FileListResponse>
    delete: (provider: Provider, fileId: string) => Promise<any>
    retrieve: (provider: Provider, fileId: string) => Promise<FileUploadResponse>
  }
  vertexAI: {
    getAuthHeaders: (params: {
      projectId: string
      serviceAccount?: {
        privateKey: string
        clientEmail: string
      }
    }) => Promise<any>
    getAccessToken: (params: {
      projectId: string
      serviceAccount?: {
        privateKey: string
        clientEmail: string
      }
    }) => Promise<any>
    clearAuthCache: (projectId: string, clientEmail?: string) => Promise<any>
  }
  ovms: {
    isSupported: () => Promise<boolean>
    addModel: (modelName: string, modelId: string, modelSource: string, task: string) => Promise<any>
    stopAddModel: () => Promise<any>
    getModels: () => Promise<any>
    isRunning: () => Promise<any>
    getStatus: () => Promise<any>
    runOvms: () => Promise<any>
    stopOvms: () => Promise<any>
  }
  config: {
    set: (key: string, value: any, isNotify?: boolean) => Promise<any>
    get: (key: string) => Promise<any>
  }
  miniWindow: {
    show: () => Promise<any>
    hide: () => Promise<any>
    close: () => Promise<any>
    toggle: () => Promise<any>
    setPin: (isPinned: boolean) => Promise<any>
    onShow: (callback: () => void) => () => void
  }
  aes: {
    encrypt: (text: string, secretKey: string, iv: string) => Promise<any>
    decrypt: (encryptedData: string, iv: string, secretKey: string) => Promise<any>
  }
  python: {
    execute: (script: string, context?: Record<string, any>, timeout?: number) => Promise<any>
    onExecutionRequest: (callback: (request: any) => void) => () => void
    sendExecutionResponse: (response: any) => void
  }
  shell: {
    openExternal: (url: string, options?: { activate?: boolean; workingDirectory?: string }) => Promise<void>
  }
  copilot: {
    getAuthMessage: (headers?: Record<string, string>) => Promise<any>
    getCopilotToken: (device_code: string, headers?: Record<string, string>) => Promise<any>
    saveCopilotToken: (access_token: string) => Promise<any>
    getToken: (headers?: Record<string, string>) => Promise<any>
    logout: () => Promise<any>
    getUser: (token: string) => Promise<any>
  }
  cherryin: {
    saveToken: (accessToken: string, refreshToken?: string) => Promise<any>
    hasToken: () => Promise<boolean>
    getBalance: (apiHost: string) => Promise<any>
    logout: (apiHost: string) => Promise<any>
    startOAuthFlow: (oauthServer: string, apiHost?: string) => Promise<any>
    exchangeToken: (code: string, state: string) => Promise<any>
  }
  isBinaryExist: (name: string) => Promise<any>
  getBinaryPath: (name: string) => Promise<any>
  installUVBinary: () => Promise<any>
  installBunBinary: () => Promise<any>
  installOvmsBinary: () => Promise<any>
  externalApps: {
    detectInstalled: () => Promise<ExternalAppInfo[]>
  }
  storeSync: {
    subscribe: () => Promise<any>
    unsubscribe: () => Promise<any>
    onUpdate: (action: any) => Promise<any>
    onBroadcast: (callback: (action: any) => void) => () => void
  }
  agentTools: {
    respondToPermission: (payload: {
      requestId: string
      behavior: 'allow' | 'deny'
      updatedInput?: Record<string, unknown>
      message?: string
      updatedPermissions?: PermissionUpdate[]
    }) => Promise<any>
    onPermissionRequest: (callback: (payload: any) => void) => () => void
    onPermissionResult: (callback: (payload: any) => void) => () => void
  }
  agentMessages: {
    getHistory: (sessionId: string) => Promise<any>
    persistExchange: (payload: any) => Promise<any>
  }
  agentSessionStream: {
    subscribe: (sessionId: string) => Promise<any>
    unsubscribe: (sessionId: string) => Promise<any>
    abort: (sessionId: string) => Promise<any>
    onChunk: (
      callback: (chunk: {
        sessionId: string
        agentId: string
        type: string
        chunk?: any
        error?: any
        userMessage?: {
          chatId: string
          userId: string
          userName: string
          text: string
          images?: Array<{
            data: string
            media_type: string
          }>
          files?: Array<{
            filename: string
            media_type: string
            size: number
          }>
        }
      }) => void
    ) => () => void
    onSessionChanged: (
      callback: (data: { agentId: string; sessionId: string; headless?: boolean }) => void
    ) => () => void
  }
  wechat: {
    onQrLogin: (
      callback: (data: { channelId: string; agentId: string; url: string; status: string; userId?: string }) => void
    ) => () => void
    hasCredentials: (channelId: string) => Promise<{
      exists: boolean
      userId?: string
    }>
  }
  feishu: {
    onQrLogin: (
      callback: (data: {
        channelId: string
        agentId: string
        url: string
        status: string
        appId?: string
        appSecret?: string
      }) => void
    ) => () => void
  }
  channel: {
    onLog: (
      callback: (log: { timestamp: number; level: string; message: string; channelId: string }) => void
    ) => () => void
    onStatusChange: (
      callback: (status: { channelId: string; connected: boolean; error?: string }) => void
    ) => () => void
    getLogs: (channelId: string) => Promise<
      Array<{
        timestamp: number
        level: string
        message: string
        channelId: string
      }>
    >
    getStatuses: () => Promise<
      Array<{
        channelId: string
        connected: boolean
        error?: string
      }>
    >
  }
  quoteToMainWindow: (text: string) => Promise<any>
  onQuoteToMainWindow: (callback: (text: string) => void) => () => void
  setUseSystemTitleBar: (isActive: boolean) => Promise<any>
  trace: {
    saveData: (topicId: string) => Promise<any>
    getData: (topicId: string, traceId: string, modelName?: string) => Promise<any>
    saveEntity: (entity: SpanEntity) => Promise<any>
    getEntity: (spanId: string) => Promise<any>
    bindTopic: (topicId: string, traceId: string) => Promise<any>
    tokenUsage: (spanId: string, usage: TokenUsage) => Promise<any>
    cleanHistory: (topicId: string, traceId: string, modelName?: string) => Promise<any>
    cleanTopic: (topicId: string, traceId?: string) => Promise<any>
    openWindow: (topicId: string, traceId: string, autoOpen?: boolean, modelName?: string) => Promise<any>
    setTraceWindowTitle: (title: string) => Promise<any>
    addEndMessage: (spanId: string, modelName: string, context: string) => Promise<any>
    cleanLocalData: () => Promise<any>
    addStreamMessage: (spanId: string, modelName: string, context: string, message: any) => Promise<any>
    onceSetTrace: (callback: (data: any) => void) => void
    onceSetLanguage: (callback: (data: any) => void) => void
  }
  anthropic_oauth: {
    startOAuthFlow: () => Promise<any>
    completeOAuthWithCode: (code: string) => Promise<any>
    cancelOAuthFlow: () => Promise<any>
    getAccessToken: () => Promise<any>
    hasCredentials: () => Promise<any>
    clearCredentials: () => Promise<any>
  }
  codeTools: {
    run: (
      cliTool: string,
      model: string,
      directory: string,
      env: Record<string, string>,
      options?: {
        autoUpdateToLatest?: boolean
        terminal?: string
      }
    ) => Promise<CodeToolsRunResult>
    getAvailableTerminals: () => Promise<TerminalConfig[]>
    setCustomTerminalPath: (terminalId: string, path: string) => Promise<void>
    getCustomTerminalPath: (terminalId: string) => Promise<string | undefined>
    removeCustomTerminalPath: (terminalId: string) => Promise<void>
  }
  ocr: {
    ocr: (file: SupportedOcrFile, provider: OcrProvider) => Promise<OcrResult>
    listProviders: () => Promise<string[]>
  }
  cherryai: {
    generateSignature: (params: {
      method: string
      path: string
      query: string
      body: Record<string, any>
    }) => Promise<any>
  }
  windowControls: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    unmaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
  }
  apiServer: {
    getStatus: () => Promise<GetApiServerStatusResult>
    start: () => Promise<StartApiServerStatusResult>
    restart: () => Promise<RestartApiServerStatusResult>
    stop: () => Promise<StopApiServerStatusResult>
    onReady: (callback: () => void) => () => void
  }
  skill: {
    list: () => Promise<SkillResult<InstalledSkill[]>>
    install: (options: SkillInstallOptions) => Promise<SkillResult<InstalledSkill>>
    uninstall: (skillId: string) => Promise<SkillResult<void>>
    toggle: (options: SkillToggleOptions) => Promise<SkillResult<InstalledSkill | null>>
    installFromZip: (options: SkillInstallFromZipOptions) => Promise<SkillResult<InstalledSkill>>
    installFromDirectory: (options: SkillInstallFromDirectoryOptions) => Promise<SkillResult<InstalledSkill>>
    readSkillFile: (skillId: string, filename: string) => Promise<SkillResult<string | null>>
    listFiles: (skillId: string) => Promise<SkillResult<SkillFileNode[]>>
    listLocal: (workdir: string) => Promise<SkillResult<LocalSkill[]>>
  }
  openclaw: {
    checkInstalled: () => Promise<{
      installed: boolean
      path: string | null
      needsMigration: boolean
    }>
    install: () => Promise<OperationResult>
    uninstall: () => Promise<OperationResult>
    startGateway: (port?: number) => Promise<OperationResult>
    stopGateway: () => Promise<OperationResult>
    getStatus: () => Promise<{
      status: OpenClawGatewayStatus
      port: number
    }>
    checkHealth: () => Promise<OpenClawHealthInfo>
    getDashboardUrl: () => Promise<string>
    syncConfig: (provider: Provider, primaryModel: Model) => Promise<OperationResult>
    getChannels: () => Promise<OpenClawChannelInfo[]>
    checkUpdate: () => Promise<{
      hasUpdate: boolean
      currentVersion: string | null
      latestVersion: string | null
      message?: string
    }>
    performUpdate: () => Promise<OperationResult>
    onInstallProgress: (callback: (data: { message: string; type: 'info' | 'warn' | 'error' }) => void) => () => void
  }
}
export type NativeApi = typeof api

declare global {
  interface Window {
    api: NativeApi
  }
}
