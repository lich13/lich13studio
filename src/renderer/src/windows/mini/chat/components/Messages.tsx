import { LoadingOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import type { Assistant, Topic } from '@renderer/types'
import { Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { shouldShowMiniWindowEmptyState, shouldShowMiniWindowPendingSpinner } from '../../home/miniWindowHelpers'
import MessageItem from './Message'

interface Props {
  assistant: Assistant
  topic: Topic
  isOutputted: boolean
  isLoading: boolean
  hasError: boolean
}

interface ContainerProps {
  right?: boolean
  $isEmpty?: boolean
}

const Messages: FC<Props> = ({ assistant, topic, isOutputted, isLoading, hasError }) => {
  const { t } = useTranslation()
  const messages = useTopicMessages(topic.id)
  const messageCount = messages.length
  const showPendingSpinner = shouldShowMiniWindowPendingSpinner({ isLoading, isOutputted, messageCount })
  const showEmptyState = shouldShowMiniWindowEmptyState({ isLoading, messageCount, hasError })
  const modelName = assistant.model?.name ?? assistant.name

  return (
    <Container id="messages" key={assistant.id} $isEmpty={showEmptyState}>
      {showEmptyState && (
        <EmptyState>
          <EmptyIcon>
            <Sparkles size={18} />
          </EmptyIcon>
          <EmptyTitle>{t('miniwindow.header.default_assistant')}</EmptyTitle>
          <EmptySubtitle>{t('miniwindow.input.placeholder.empty', { model: modelName })}</EmptySubtitle>
        </EmptyState>
      )}
      {showPendingSpinner && <PendingSpinner style={{ fontSize: 15 }} spin />}
      {[...messages].reverse().map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </Container>
  )
}

const Container = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: ${({ $isEmpty }) => ($isEmpty ? 'column' : 'column-reverse')};
  align-items: center;
  justify-content: ${({ $isEmpty }) => ($isEmpty ? 'center' : 'flex-start')};
  padding: ${({ $isEmpty }) => ($isEmpty ? '18px' : '0 10px 16px')};
  overflow-x: hidden;
  min-width: 100%;
  background-color: transparent !important;
`

const PendingSpinner = styled(LoadingOutlined)`
  margin: 18px 0 4px;
  color: var(--color-text-secondary);
`

const EmptyState = styled.div`
  display: flex;
  max-width: 300px;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  text-align: center;
`

const EmptyIcon = styled.div`
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-primary);
`

const EmptyTitle = styled.div`
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
`

const EmptySubtitle = styled.div`
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
`

export default Messages
