import EmojiIcon from '@renderer/components/EmojiIcon'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { Assistant } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ModelTestButton from '../../ModelTestButton'
import SelectModelButton from '../../SelectModelButton'
import Tools from '../Tools'

type TopicContentProps = {
  assistant: Assistant
}

const TopicContent = ({ assistant }: TopicContentProps) => {
  const { t } = useTranslation()
  const ControlsContainer = runtimeCapabilities.android ? 'div' : HorizontalScrollContainer
  const assistantName = useMemo(() => assistant.name || t('chat.default.name'), [assistant.name, t])

  return (
    <>
      <ControlsContainer className="chat-target-controls ml-2 flex-initial">
        <div
          className={
            runtimeCapabilities.android
              ? 'flex w-full min-w-0 flex-col items-stretch gap-2'
              : 'flex flex-nowrap items-center gap-2'
          }>
          {/* Assistant Label */}
          <div
            className="assistant-settings-trigger flex h-full shrink-0 cursor-pointer items-center gap-1.5"
            onClick={() => AssistantSettingsPopup.show({ assistant })}>
            <EmojiIcon emoji={assistant.emoji || getLeadingEmoji(assistantName)} size={24} />
            <span className="max-w-24 truncate text-xs xl:max-w-40" title={assistantName}>
              {assistantName}
            </span>
          </div>

          {/* Separator */}
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />

          {/* Model Button */}
          <SelectModelButton assistant={assistant} />
          {!runtimeCapabilities.android && <ModelTestButton />}
        </div>
      </ControlsContainer>
      {!runtimeCapabilities.android && <Tools assistant={assistant} />}
    </>
  )
}

export default TopicContent
