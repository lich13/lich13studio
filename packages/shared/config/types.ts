import type { ProcessingStatus } from '@types'

// =============================================================================
// Code Tools Types
// =============================================================================

export interface CodeToolsRunResult {
  success: boolean
  message: string
  command: string
}

// =============================================================================
// OpenClaw IPC Types
// =============================================================================

export type OperationResult = { success: true } | { success: false; message: string }

export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
  status?: ProcessingStatus
  message?: string
  messageSource?: 'preprocess' | 'embedding' | 'validation'
}

export type FileChangeEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'refresh'

export type FileChangeEvent = {
  eventType: FileChangeEventType
  filePath: string
  watchPath: string
}

// Channel log & status types
export type ChannelLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ChannelLogEntry = {
  timestamp: number
  level: ChannelLogLevel
  message: string
  channelId: string
}

export type ChannelStatusEvent = {
  channelId: string
  connected: boolean
  error?: string
}

export type WebviewKeyEvent = {
  webviewId: number
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface WebSocketStatusResponse {
  isRunning: boolean
  port?: number
  ip?: string
  clientConnected: boolean
}

export interface WebSocketCandidatesResponse {
  host: string
  interface: string
  priority: number
}
