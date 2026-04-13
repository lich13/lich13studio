import { ArrowLeftOutlined } from '@ant-design/icons'
import { McpLogo } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { Button, Flex } from 'antd'
import { Package } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer } from '..'
import BuiltinMCPServerList from './BuiltinMCPServerList'
import InstallNpxUv from './InstallNpxUv'
import McpServersList from './McpServersList'
import McpSettings from './McpSettings'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const getActiveView = () => {
    const path = location.pathname

    if (path === '/settings/mcp/builtin') return 'builtin'
    return 'servers'
  }

  const activeView = getActiveView()

  const isHomePage = () => {
    const path = location.pathname
    if (path === '/settings/mcp' || path === '/settings/mcp/servers') return true
    return path === '/settings/mcp/builtin'
  }

  return (
    <Container>
      <MainContainer>
        <MenuList>
          <ListItem
            title={t('settings.mcp.servers', 'MCP Servers')}
            active={activeView === 'servers'}
            onClick={() => navigate('/settings/mcp/servers')}
            icon={<McpLogo width={18} height={18} style={{ opacity: 0.8 }} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <ListItem
            title={t('settings.mcp.builtinServers', 'Built-in Servers')}
            active={activeView === 'builtin'}
            onClick={() => navigate('/settings/mcp/builtin')}
            icon={<Package size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
        </MenuList>
        <RightContainer>
          {!isHomePage() && (
            <BackButtonContainer>
              <Link to="/settings/mcp/servers">
                <Button type="default" shape="circle" size="small">
                  <ArrowLeftOutlined />
                </Button>
              </Link>
            </BackButtonContainer>
          )}
          <Routes>
            <Route index element={<Navigate to="servers" replace />} />
            <Route path="servers" element={<McpServersList />} />
            <Route path="settings/:serverId" element={<McpSettings />} />
            <Route
              path="mcp-install"
              element={
                <SettingContainer style={{ backgroundColor: 'inherit' }}>
                  <InstallNpxUv />
                </SettingContainer>
              }
            />
            <Route
              path="builtin"
              element={
                <ContentWrapper>
                  <BuiltinMCPServerList />
                </ContentWrapper>
              }
            />
            <Route path="*" element={<Navigate to="/settings/mcp/servers" replace />} />
          </Routes>
        </RightContainer>
      </MainContainer>
    </Container>
  )
}

const Container = styled(Flex)`
  flex: 1;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  width: 100%;
  height: calc(100vh - var(--navbar-height) - 6px);
  overflow: hidden;
`

const MenuList = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
`

const RightContainer = styled.div`
  flex: 1;
  position: relative;
`

const ContentWrapper = styled.div`
  padding: 20px;
  overflow-y: auto;
  height: 100%;
`

const BackButtonContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: transparent;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
`

export default MCPSettings
