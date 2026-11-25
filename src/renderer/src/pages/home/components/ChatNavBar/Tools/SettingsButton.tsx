import { useMobileBack } from '@renderer/services/mobile/back'
import { runtimeCapabilities } from '@renderer/services/mobile/runtime'
import type { Assistant } from '@renderer/types'
import { Drawer, Tooltip } from 'antd'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import NavbarIcon from '../../../../../components/NavbarIcon'
import { AssistantSettingsTab } from './SettingsTab'

interface Props {
  assistant?: Assistant
}

const SettingsButton: FC<Props> = ({ assistant }) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  useMobileBack(runtimeCapabilities.android && settingsOpen, () => setSettingsOpen(false))

  return (
    <>
      <Tooltip title={t('settings.title')} mouseEnterDelay={0.8}>
        <NavbarIcon
          role="button"
          aria-label={t('settings.title')}
          className={runtimeCapabilities.android ? 'mobile-navbar-action' : undefined}
          onClick={() => setSettingsOpen(true)}>
          <Settings2 size={18} />
        </NavbarIcon>
      </Tooltip>
      <Drawer
        title={runtimeCapabilities.android ? t('settings.messages.title') : undefined}
        placement="right"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width="var(--assistants-width)"
        closable={runtimeCapabilities.android}
        styles={{
          header: runtimeCapabilities.android ? { padding: '10px 12px' } : { display: 'none' },
          body: { padding: 0, paddingTop: runtimeCapabilities.android ? 0 : 'var(--navbar-height)' }
        }}>
        {assistant && <AssistantSettingsTab assistant={assistant} />}
      </Drawer>
    </>
  )
}

export default SettingsButton
