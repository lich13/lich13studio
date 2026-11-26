import { Tooltip } from 'antd'
import { Brain } from 'lucide-react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ReasoningIcon: FC<React.HTMLAttributes<HTMLDivElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container {...props}>
      <Tooltip title={t('models.type.reasoning')} placement="top">
        <IconWrap>
          <Brain size={15} className="lucide-custom" />
        </IconWrap>
      </Tooltip>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const IconWrap = styled.span`
  display: inline-flex;
  align-items: center;
  color: var(--color-link);
  margin-right: 6px;
`

export default ReasoningIcon
