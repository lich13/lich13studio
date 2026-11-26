import { ActionIconButton } from '@renderer/components/Buttons'
import { ArrowUp, CirclePause } from 'lucide-react'
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
        <CirclePause size={20} className="lucide-custom" color="var(--color-error)" />
      </ActionIconButton>
    )
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : sendMessage}
      onKeyDown={handleKeyDown}
      aria-label={t('chat.input.send')}
      aria-disabled={disabled}
      disabled={disabled}
      title={t('chat.input.send')}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none p-0 transition-all duration-150"
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: disabled ? 'var(--color-background-mute)' : 'var(--color-primary)',
        color: disabled ? 'var(--color-text-3)' : '#ffffff',
        marginRight: 1
      }}>
      <ArrowUp size={16} strokeWidth={2.25} className="lucide-custom" />
    </button>
  )
}

export default SendMessageButton
