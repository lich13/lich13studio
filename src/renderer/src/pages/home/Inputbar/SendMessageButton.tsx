import { ActionIconButton } from '@renderer/components/Buttons'
import { CirclePause } from 'lucide-react'
import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  disabled: boolean
  sendMessage: () => void
  isLoading?: boolean
  pauseMessage?: () => void
}

const SendMessageButton: FC<Props> = ({ disabled, sendMessage, isLoading = false, pauseMessage }) => {
  const { t } = useTranslation()

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (isLoading && pauseMessage && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      pauseMessage()
      return
    }

    if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (isLoading) {
    return (
      <ActionIconButton
        onClick={pauseMessage}
        onKeyDown={handleKeyDown}
        aria-label={t('chat.input.pause')}
        title={t('chat.input.pause')}
        style={{ marginRight: -2 }}>
        <CirclePause size={20} color="var(--color-error)" />
      </ActionIconButton>
    )
  }

  return (
    <i
      className="iconfont icon-ic_send"
      onClick={disabled ? undefined : sendMessage}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={t('chat.input.send')}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
        fontSize: 22,
        transition: 'all 0.2s',
        marginTop: 1,
        marginRight: 2
      }}
    />
  )
}

export default SendMessageButton
