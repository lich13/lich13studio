import ActionIconButton from '@renderer/components/Buttons/ActionIconButton'
import { useSettings } from '@renderer/hooks/useSettings'
import { Tooltip } from 'antd'
import { Waves } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Shared request-mode control used by the main chat input toolbar. */
export default function ChatRequestModeToggle() {
  const { t } = useTranslation()
  const { chatRequestMode, setChatRequestMode } = useSettings()
  const streaming = chatRequestMode === 'stream'
  const current = streaming ? t('chat.request_mode.stream') : t('chat.request_mode.non_stream')
  const next = streaming ? t('chat.request_mode.non_stream') : t('chat.request_mode.stream')
  const label = t('chat.request_mode.title') + ': ' + current + ' · ' + next

  return (
    <Tooltip title={label}>
      <ActionIconButton
        active={streaming}
        aria-label={label}
        aria-pressed={streaming}
        onClick={() => setChatRequestMode(streaming ? 'non-stream' : 'stream')}>
        <Waves size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}
