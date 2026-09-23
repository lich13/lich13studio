import i18n from '@renderer/i18n'
import { NotificationService } from '@renderer/services/NotificationService'

import { uuid } from '.'

// Debounced notification for tool approval requests.
// Batches rapid-fire tool approval requests into a single notification.
const NOTIFICATION_DEBOUNCE_MS = 500
let pendingNotificationTools: string[] = []
let notificationTimer: ReturnType<typeof setTimeout> | null = null

function flushToolApprovalNotification() {
  notificationTimer = null
  const tools = pendingNotificationTools
  pendingNotificationTools = []

  if (tools.length === 0) return

  const message =
    tools.length === 1
      ? i18n.t('message.tools.approvalRequired', { tool: tools[0] })
      : i18n.t('message.tools.approvalRequired', { tool: `${tools.length} tools` })

  void NotificationService.getInstance().send({
    id: uuid(),
    type: 'action',
    title: i18n.t('notification.assistant'),
    message,
    timestamp: Date.now(),
    channel: 'system',
    source: 'assistant'
  })
}

export function sendToolApprovalNotification(toolName: string): void {
  pendingNotificationTools.push(toolName)
  if (notificationTimer) clearTimeout(notificationTimer)
  notificationTimer = setTimeout(flushToolApprovalNotification, NOTIFICATION_DEBOUNCE_MS)
}
