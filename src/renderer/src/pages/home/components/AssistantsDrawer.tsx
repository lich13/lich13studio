import { TopView } from '@renderer/components/TopView'
import { isMac } from '@renderer/config/constant'
import { useTimer } from '@renderer/hooks/useTimer'
import { useMobileBack } from '@renderer/services/mobile/back'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { Assistant, Topic } from '@renderer/types'
import { Drawer } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import HomeTabs from '../Tabs'

interface ShowParams {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  activeAssistant,
  setActiveAssistant,
  activeTopic,
  setActiveTopic,
  resolve
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { setTimeoutTimer } = useTimer()

  const onClose = () => {
    setOpen(false)
    setTimeoutTimer('onClose', resolve, 300)
  }

  useMobileBack(runtimeCapabilities.android && open, onClose)
  AssistantsDrawer.hide = onClose

  return (
    <Drawer
      title={runtimeCapabilities.android ? `${t('assistants.abbr')} / ${t('common.topics')}` : null}
      closable={runtimeCapabilities.android}
      height="var(--app-viewport-height)"
      placement="left"
      open={open}
      onClose={onClose}
      style={{ width: 'var(--assistants-width)' }}
      styles={{
        header: runtimeCapabilities.android ? { padding: '8px 12px', minHeight: 48 } : { display: 'none' },
        body: {
          display: 'flex',
          padding: 0,
          paddingTop: isMac && !runtimeCapabilities.android ? 'var(--navbar-height)' : 0,
          height: runtimeCapabilities.android ? '100%' : 'calc(var(--app-viewport-height) - var(--navbar-height))',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background-opacity)'
        },
        wrapper: {
          width: 'var(--assistants-width)'
        }
      }}>
      <HomeTabs
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        forceToSeeAllTab={runtimeCapabilities.android}
        style={runtimeCapabilities.android ? { height: '100%', width: '100%' } : undefined}
        setActiveAssistant={(assistant) => {
          setActiveAssistant(assistant)
          onClose()
        }}
        setActiveTopic={(topic) => {
          setActiveTopic(topic)
          onClose()
        }}
        position="left"
      />
    </Drawer>
  )
}

const TopViewKey = 'AssistantsDrawer'

export default class AssistantsDrawer {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
