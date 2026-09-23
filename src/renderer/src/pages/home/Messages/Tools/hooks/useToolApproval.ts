import type { ToolMessageBlock } from '@renderer/types/newMessage'

import { useAgentToolApproval } from './useAgentToolApproval'

/**
 * Unified tool approval state
 */
export interface ToolApprovalState {
  /** Whether the tool is waiting for user confirmation */
  isWaiting: boolean
  /** Whether the tool is currently executing after approval */
  isExecuting: boolean
  /** Whether a submission is in progress (Agent only) */
  isSubmitting: boolean
  /** Tool input from permission request (Agent only) */
  input?: Record<string, unknown>
}

/**
 * Unified tool approval actions
 */
export interface ToolApprovalActions {
  /** Confirm/approve the tool execution */
  confirm: () => void | Promise<void>
  /** Cancel/deny the tool execution */
  cancel: () => void | Promise<void>
  /** Auto-approve this tool for future calls (if available) */
  autoApprove?: () => void | Promise<void>
}

export function useToolApproval(block: ToolMessageBlock): ToolApprovalState & ToolApprovalActions {
  return useAgentToolApproval(block)
}

/**
 * Determine if an active agent tool needs approval
 */
export function isBlockWaitingApproval(block: ToolMessageBlock): boolean {
  const response = block.metadata?.rawMcpToolResponse
  return response?.tool.type !== 'mcp' && !response?.tool.name.startsWith('mcp__') && response?.status === 'pending'
}

export { useAgentToolApproval, type UseAgentToolApprovalOptions } from './useAgentToolApproval'
