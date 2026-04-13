import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { McpLogo } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { Divider as AntDivider } from 'antd'
import {
  Cloud,
  HardDrive,
  MonitorCog,
  Package,
  Search,
  Settings2,
  Zap
} from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import { ProviderList } from './ProviderSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import WebSearchSettings from './WebSearchSettings'

const SettingsPage: FC = () => {
  const { pathname } = useLocation()
  const { t } = useTranslation()

  const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingMenus>
          <MenuItemLink to="/settings/provider">
            <MenuItem className={isRoute('/settings/provider')}>
              <Cloud size={18} />
              {t('settings.provider.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/model">
            <MenuItem className={isRoute('/settings/model')}>
              <Package size={18} />
              {t('settings.model')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/general">
            <MenuItem className={isRoute('/settings/general')}>
              <Settings2 size={18} />
              {t('settings.general.label')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/display">
            <MenuItem className={isRoute('/settings/display')}>
              <MonitorCog size={18} />
              {t('settings.display.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/data">
            <MenuItem className={isRoute('/settings/data')}>
              <HardDrive size={18} />
              {t('settings.data.title')}
            </MenuItem>
          </MenuItemLink>
          <Divider />
          <MenuItemLink to="/settings/mcp">
            <MenuItem className={isRoute('/settings/mcp')}>
              <McpLogo width={18} height={18} style={{ opacity: 0.8 }} />
              {t('settings.mcp.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/websearch">
            <MenuItem className={isRoute('/settings/websearch')}>
              <Search size={18} />
              {t('settings.tool.websearch.title')}
            </MenuItem>
          </MenuItemLink>
          <MenuItemLink to="/settings/quickphrase">
            <MenuItem className={isRoute('/settings/quickphrase')}>
              <Zap size={18} />
              {t('settings.quickPhrase.title')}
            </MenuItem>
          </MenuItemLink>
        </SettingMenus>
        <SettingContent>
          <Routes>
            <Route path="provider" element={<ProviderList />} />
            <Route path="model" element={<ModelSettings />} />
            <Route path="websearch/*" element={<WebSearchSettings />} />
            <Route path="quickphrase" element={<QuickPhraseSettings />} />
            <Route path="mcp/*" element={<MCPSettings />} />
            <Route path="general/*" element={<GeneralSettings />} />
            <Route path="display" element={<DisplaySettings />} />
            <Route path="data" element={<DataSettings />} />
            <Route path="*" element={<Navigate to="/settings/provider" replace />} />
          </Routes>
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  padding: 1px 0;
`

const SettingMenus = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  min-width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 10px;
  user-select: none;
  gap: 5px;
`

const MenuItemLink = styled(Link)`
  text-decoration: none;
  color: var(--color-text-1);
`

const MenuItem = styled.li`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  width: 100%;
  cursor: pointer;
  border-radius: var(--list-item-border-radius);
  font-weight: 500;
  transition: all 0.2s ease-in-out;
  border: 0.5px solid transparent;
  .anticon {
    font-size: 16px;
    opacity: 0.8;
  }
  &:hover {
    background: var(--color-background-soft);
  }
  &.active {
    background: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

const SettingContent = styled.div`
  display: flex;
  height: 100%;
  flex: 1;
`

const Divider = styled(AntDivider)`
  margin: 3px 0;
`

export default SettingsPage
