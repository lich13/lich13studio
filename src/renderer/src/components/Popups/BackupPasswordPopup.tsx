import { Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

export function requestBackupPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    const id = `backup-password-${crypto.randomUUID()}`
    function Dialog() {
      const [password, setPassword] = useState('')
      const { t } = useTranslation()
      const close = (value: string | null) => {
        setPassword('')
        TopView.hide(id)
        resolve(value)
      }
      return (
        <Modal
          open
          centered
          title={t('backup.password')}
          onCancel={() => close(null)}
          onOk={() => close(password)}
          okButtonProps={{ disabled: !password }}>
          <Input.Password
            autoComplete="off"
            value={password}
            aria-label={t('backup.password')}
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => password && close(password)}
          />
        </Modal>
      )
    }
    TopView.show(<Dialog />, id)
  })
}
