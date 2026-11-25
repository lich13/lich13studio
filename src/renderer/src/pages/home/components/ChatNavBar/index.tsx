import { NavbarHeader } from '@renderer/components/app/Navbar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { Assistant, Topic } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Menu, MessageSquarePlus, PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'
import AssistantsDrawer from '../AssistantsDrawer'
import SelectModelButton from '../SelectModelButton'
import ChatNavbarContent from './ChatNavbarContent'
import SettingsButton from './Tools/SettingsButton'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
  position: 'left' | 'right'
}

const HeaderNavbar: FC<Props> = ({ activeAssistant, setActiveAssistant, activeTopic, setActiveTopic }) => {
  const { assistant, addTopic } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { isTopNavbar } = useNavbarPosition()

  useShortcut('search_message', () => {
    void SearchPopup.show()
  })

  const onShowAssistantsDrawer = () => {
    void AssistantsDrawer.show({
      activeAssistant,
      setActiveAssistant,
      activeTopic,
      setActiveTopic
    })
  }

  const onCreateNewTopic = () => {
    const newTopic = getDefaultTopic(assistant.id)
    addTopic(newTopic)
    setActiveTopic(newTopic)
  }

  if (runtimeCapabilities.android) {
    const assistantName = assistant.name || t('chat.default.name')
    return (
      <NavbarHeader className="home-navbar mobile-home-navbar">
        <div className="mobile-navbar-top-row">
          <NavbarIcon
            role="button"
            aria-label={t('assistants.abbr')}
            className="mobile-drawer-toggle"
            onClick={onShowAssistantsDrawer}>
            <Menu size={18} />
          </NavbarIcon>
          <button
            type="button"
            className="assistant-settings-trigger mobile-assistant-trigger"
            title={assistantName}
            onClick={() => AssistantSettingsPopup.show({ assistant })}>
            <EmojiIcon emoji={assistant.emoji || getLeadingEmoji(assistantName)} size={22} />
            <span className="mobile-assistant-name">{assistantName}</span>
          </button>
          <div className="mobile-navbar-actions">
            <NavbarIcon
              role="button"
              aria-label={t('chat.assistant.search.placeholder')}
              className="mobile-navbar-action"
              onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NavbarIcon>
            <SettingsButton assistant={assistant} />
            <NavbarIcon
              role="button"
              aria-label={t('chat.topics.new')}
              className="mobile-navbar-action"
              onClick={onCreateNewTopic}>
              <MessageSquarePlus size={18} />
            </NavbarIcon>
          </div>
        </div>
        <div className="mobile-navbar-model-row">
          <SelectModelButton assistant={assistant} />
        </div>
      </NavbarHeader>
    )
  }

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        {isTopNavbar && showAssistants && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={toggleShowAssistants}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showAssistants && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8} placement="right">
            <NavbarIcon onClick={() => toggleShowAssistants()} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <AnimatePresence initial={false}>
          {!showAssistants && isTopNavbar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}>
              <NavbarIcon
                role="button"
                aria-label={t('assistants.abbr')}
                className="mobile-drawer-toggle"
                onClick={onShowAssistantsDrawer}
                style={{ marginRight: 5 }}>
                <Menu size={18} />
              </NavbarIcon>
            </motion.div>
          )}
        </AnimatePresence>
        <ChatNavbarContent assistant={assistant} />
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
