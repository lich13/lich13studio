import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'

interface MessageEditingContextType {
  editingMessageId: string | null
  startEditing: (messageId: string) => void
  stopEditing: () => void
}

const MessageEditingContext = createContext<MessageEditingContextType | null>(null)

export function MessageEditingProvider({ children }: { children: ReactNode }) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  const startEditing = useCallback((messageId: string) => {
    setEditingMessageId(messageId)
  }, [])

  const stopEditing = useCallback(() => {
    setEditingMessageId(null)
  }, [])

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (targetId: string) => {
      if (typeof targetId === 'string' && targetId) {
        setEditingMessageId(targetId)
      }
    })
  }, [])

  const value = useMemo(
    () => ({ editingMessageId, startEditing, stopEditing }),
    [editingMessageId, startEditing, stopEditing]
  )

  return <MessageEditingContext value={value}>{children}</MessageEditingContext>
}

export function useMessageEditing() {
  const context = use(MessageEditingContext)
  if (!context) {
    throw new Error('useMessageEditing must be used within a MessageEditingProvider')
  }
  return context
}
