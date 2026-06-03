import { Button, Tooltip } from 'antd'
import { Camera } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  canCaptureImage: boolean
  capturing: boolean
  onClick: () => void
}

const MiniWindowCaptureButton: FC<Props> = ({ canCaptureImage, capturing, onClick }) => {
  const { t } = useTranslation()

  return (
    <CaptureRoot>
      <Tooltip placement="top" title={t('chat.input.capture.label')} mouseLeaveDelay={0} arrow>
        <CaptureButton
          type="text"
          aria-label={t('chat.input.capture.label')}
          aria-disabled={!canCaptureImage}
          disabled={capturing}
          $canCaptureImage={canCaptureImage}
          onClick={onClick}>
          <Camera size={16} />
        </CaptureButton>
      </Tooltip>
    </CaptureRoot>
  )
}

const CaptureRoot = styled.div`
  position: relative;
  display: flex;
  -webkit-app-region: none;
`

const CaptureButton = styled(Button)<{ $canCaptureImage: boolean }>`
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  border-radius: 8px;
  opacity: ${({ $canCaptureImage }) => ($canCaptureImage ? 1 : 0.68)};

  &:hover {
    color: var(--color-text);
    background: var(--color-background-mute);
  }
`

export default MiniWindowCaptureButton
