import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import type { SidebarIcon } from '@renderer/types'
import { Tooltip } from 'antd'
import {
  Code,
  Folder,
  LayoutGrid,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette,
  Settings
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
import { SidebarOpenedMinappTabs, SidebarPinnedApps } from './PinnedMinapps'

const Sidebar: FC = () => {
  const { hideMinappPopup } = useMinappPopup()
  const { minappShow } = useRuntime()
  const { sidebarIcons } = useSettings()
  const { pinned } = useMinapps()

  const backgroundColor = useNavBackgroundColor()

  const showPinnedApps = pinned.length > 0 && sidebarIcons.visible.includes('minapp')

  const isFullscreen = useFullscreen()

  return (
    <Container
      $isFullscreen={isFullscreen}
      id="app-sidebar"
      style={{ backgroundColor, zIndex: minappShow ? 10000 : 'initial' }}>
      <MainMenusContainer>
        <Menus onClick={hideMinappPopup}>
          <MainMenus />
        </Menus>
        <SidebarOpenedMinappTabs />
        {showPinnedApps && (
          <AppsContainer>
            <Divider />
            <Menus>
              <SidebarPinnedApps />
            </Menus>
          </AppsContainer>
        )}
      </MainMenusContainer>
    </Container>
  )
}

const MainMenus: FC = () => {
  const { hideMinappPopup } = useMinappPopup()
  const { pathname } = useLocation()
  const { sidebarIcons, defaultPaintingProvider } = useSettings()
  const { minappShow } = useRuntime()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const isRoute = (path: string): string => (pathname === path && !minappShow ? 'active' : '')
  const isRoutes = (path: string): string => (pathname.startsWith(path) && path !== '/' && !minappShow ? 'active' : '')

  type SidebarMenuItem = SidebarIcon | 'settings'

  const iconMap: Partial<Record<SidebarMenuItem, ReactNode>> = {
    assistants: <MessageSquare size={18} className="icon" />,
    settings: <Settings size={18} className="icon" />,
    agents: <MousePointerClick size={18} className="icon" />,
    paintings: <Palette size={18} className="icon" />,
    minapp: <LayoutGrid size={18} className="icon" />,
    files: <Folder size={18} className="icon" />,
    notes: <NotepadText size={18} className="icon" />,
    code_tools: <Code size={18} className="icon" />,
    openclaw: <OpenClawSidebarIcon style={{ width: 18, height: 18 }} className="icon" />
  }

  const pathMap: Partial<Record<SidebarMenuItem, string>> = {
    assistants: '/',
    settings: '/settings/provider',
    agents: '/agents',
    paintings: `/paintings/${defaultPaintingProvider}`,
    minapp: '/apps',
    files: '/files',
    code_tools: '/code',
    notes: '/notes',
    openclaw: '/openclaw'
  }

  const menuItems: SidebarMenuItem[] = []

  sidebarIcons.visible.forEach((icon) => {
    menuItems.push(icon)
    if (icon === 'assistants') {
      menuItems.push('settings')
    }
  })

  if (!menuItems.includes('settings')) {
    menuItems.unshift('settings')
  }

  return menuItems.flatMap((icon) => {
    const path = pathMap[icon]
    const iconNode = iconMap[icon]
    if (!path || !iconNode) {
      return []
    }
    const isActive =
      icon === 'settings'
        ? pathname.startsWith('/settings') && !minappShow
          ? 'active'
          : ''
        : path === '/'
          ? isRoute(path)
          : isRoutes(path)
    const title = icon === 'settings' ? t('settings.title') : getSidebarIconLabel(icon)

    return [
      <Tooltip key={icon} title={title} mouseEnterDelay={0.8} placement="right">
        <StyledLink
          onClick={async () => {
            hideMinappPopup()
            await modelGenerating()
            navigate(path)
          }}>
          <Icon theme={theme} className={isActive}>
            {iconNode}
          </Icon>
        </StyledLink>
      </Tooltip>
    ]
  })
}

const Container = styled.div<{ $isFullscreen: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  padding-bottom: 8px;
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: ${({ $isFullscreen }) =>
    isMac && !$isFullscreen ? 'calc(var(--app-viewport-height) - var(--navbar-height))' : 'var(--app-viewport-height)'};
  -webkit-app-region: drag !important;
  margin-top: ${({ $isFullscreen }) => (isMac && !$isFullscreen ? 'env(titlebar-area-height)' : 0)};
`

const MainMenusContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const Menus = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
`

const Icon = styled.div<{ theme: string }>`
  width: 33px;
  height: 33px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  box-sizing: border-box;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  .icon {
    color: var(--color-icon);
  }
  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    cursor: pointer;
    .icon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    .icon {
      color: var(--color-primary);
    }
  }

  @keyframes borderBreath {
    0% {
      opacity: 0.1;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.1;
    }
  }

  &.opened-minapp {
    position: relative;
  }
  &.opened-minapp::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    border-radius: inherit;
    opacity: 0.3;
    border: 0.5px solid var(--color-primary);
  }
`

const StyledLink = styled.div`
  text-decoration: none;
  -webkit-app-region: none;
  &* {
    user-select: none;
  }
`

const AppsContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  overflow-x: hidden;
  margin-bottom: 10px;
  -webkit-app-region: none;
  &::-webkit-scrollbar {
    display: none;
  }
`

const Divider = styled.div`
  width: 50%;
  margin: 8px 0;
  border-bottom: 0.5px solid var(--color-border);
`

export default Sidebar
