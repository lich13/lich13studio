import { useSettings } from '@renderer/hooks/useSettings'
import { Segmented, Tooltip } from 'antd'
import { Radio, RadioTower } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Shared request-mode control used by every ordinary chat surface. */
export default function ChatRequestModeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { chatRequestMode, setChatRequestMode } = useSettings()
  const options = [
    {
      value: 'stream',
      label: compact ? (
        <RadioTower size={14} aria-label={t('chat.request_mode.stream')} />
      ) : (
        t('chat.request_mode.stream')
      )
    },
    {
      value: 'non-stream',
      label: compact ? (
        <Radio size={14} aria-label={t('chat.request_mode.non_stream')} />
      ) : (
        t('chat.request_mode.non_stream')
      )
    }
  ]

  return (
    <Tooltip title={t('chat.request_mode.title')}>
      <Segmented
        size="small"
        value={chatRequestMode}
        options={options}
        onChange={(value) => setChatRequestMode(value as 'stream' | 'non-stream')}
        aria-label={t('chat.request_mode.title')}
      />
    </Tooltip>
  )
}
