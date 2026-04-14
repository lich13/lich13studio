import { Navbar, NavbarCenter, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { Search } from 'lucide-react'

import UpdateAppButton from '../home/components/UpdateAppButton'

const AgentNavbar = () => {
  const { narrowMode } = useSettings()
  const dispatch = useAppDispatch()

  useShortcut('search_message', () => {
    void SearchPopup.show()
  })

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  return (
    <Navbar className="agent-navbar">
      <NavbarLeft style={{ borderRight: 'none', padding: 0 }} />
      <NavbarCenter></NavbarCenter>
      <NavbarRight
        style={{
          justifyContent: 'flex-end',
          flex: 'none',
          position: 'relative',
          paddingRight: '15px',
          minWidth: 'auto'
        }}
        className="agent-navbar-right">
        <HStack alignItems="center" gap={6}>
          <UpdateAppButton />
          <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
            <NavbarIcon className="max-[1000px]:hidden" onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NavbarIcon>
          </Tooltip>
          <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
            <NavbarIcon className="max-[1000px]:hidden" onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NavbarIcon>
          </Tooltip>
        </HStack>
      </NavbarRight>
    </Navbar>
  )
}

export default AgentNavbar
