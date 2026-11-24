import type { ToolMessageBlock } from '@renderer/types/newMessage'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

export interface UseAgentToolApprovalOptions {
  /** Direct toolCallId (alternative to extracting from block) */
  toolCallId?: string
}

const noop = () => {}

/**
 * Read-only approval state for historical Agent tool message blocks.
 */
export function useAgentToolApproval(
  block?: ToolMessageBlock | null,
  options?: UseAgentToolApprovalOptions
): ToolApprovalState & ToolApprovalActions {
  void block
  void options
  return {
    isWaiting: false,
    isExecuting: false,
    isSubmitting: false,
    confirm: noop,
    cancel: noop
  }
}
