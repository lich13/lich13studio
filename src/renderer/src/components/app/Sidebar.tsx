import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import type { SidebarIcon } from '@renderer/types'
import { Tooltip } from 'antd'
import { MessageSquare, Settings } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const Sidebar: FC = () => {
  const backgroundColor = useNavBackgroundColor()

  const isFullscreen = useFullscreen()

  return (
    <Container $isFullscreen={isFullscreen} id="app-sidebar" style={{ backgroundColor }}>
      <MainMenusContainer>
        <Menus>
          <MainMenus />
        </Menus>
      </MainMenusContainer>
    </Container>
  )
}

const MainMenus: FC = () => {
  const { pathname } = useLocation()
  const { sidebarIcons } = useSettings()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { t } = useTranslation()

  const isRoute = (path: string): string => (pathname === path ? 'active' : '')
  const isRoutes = (path: string): string => (pathname.startsWith(path) && path !== '/' ? 'active' : '')

  type SidebarMenuItem = SidebarIcon | 'settings'

  const iconMap: Partial<Record<SidebarMenuItem, ReactNode>> = {
    assistants: <MessageSquare size={18} className="icon" />,
    settings: <Settings size={18} className="icon" />
  }

  const pathMap: Partial<Record<SidebarMenuItem, string>> = {
    assistants: '/',
    settings: '/settings/provider'
  }

  const menuItems: SidebarMenuItem[] = []

  sidebarIcons.visible.forEach((icon) => {
    if (icon in pathMap && !menuItems.includes(icon)) {
      menuItems.push(icon)
    }
    if (icon === 'assistants' && !menuItems.includes('settings')) {
      menuItems.push('settings')
    }
  })

  if (!menuItems.includes('assistants')) {
    menuItems.unshift('assistants')
  }

  if (!menuItems.includes('settings')) {
    menuItems.push('settings')
  }

  return menuItems.flatMap((icon) => {
    const path = pathMap[icon]
    const iconNode = iconMap[icon]
    if (!path || !iconNode) {
      return []
    }
    const isActive =
      icon === 'settings'
        ? pathname.startsWith('/settings')
          ? 'active'
          : ''
        : path === '/'
          ? isRoute(path)
          : isRoutes(path)
    const title = icon === 'settings' ? t('settings.title') : getSidebarIconLabel(icon)

    return [
      <Tooltip key={icon} title={title} mouseEnterDelay={0.8} placement="right">
        <StyledLink
          type="button"
          aria-label={title}
          onClick={() => {
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
  margin-top: ${({ $isFullscreen }) => (isMac && !$isFullscreen ? 'env(titlebar-area-height, 0px)' : 0)};
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
`

const StyledLink = styled.button`
  appearance: none;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-decoration: none;
  -webkit-app-region: none;
  border-radius: 50%;
  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  & * {
    user-select: none;
  }
`

export default Sidebar
