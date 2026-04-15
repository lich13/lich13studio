import Scrollbar from '@renderer/components/Scrollbar'
import styled from 'styled-components'

export const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 100%;
  box-sizing: border-box;
  padding: 8px 10px 2px;
  .multi-select-mode & {
    padding-bottom: 44px;
  }
`

interface ContainerProps {
  $right?: boolean
}

export const MessagesContainer = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: stretch;
  overflow-x: hidden;
  z-index: 1;
  position: relative;
`
