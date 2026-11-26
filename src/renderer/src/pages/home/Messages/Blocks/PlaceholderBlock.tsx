import { MessageBlockStatus, MessageBlockType, type PlaceholderMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import styled, { keyframes } from 'styled-components'

interface PlaceholderBlockProps {
  block: PlaceholderMessageBlock
}

const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ block }) => {
  if (block.status === MessageBlockStatus.PROCESSING && block.type === MessageBlockType.UNKNOWN) {
    return (
      <MessageContentLoading aria-busy="true">
        <BeatDot $delay="0s" />
        <BeatDot $delay="0.2s" />
        <BeatDot $delay="0.4s" />
      </MessageContentLoading>
    )
  }
  return null
}

const beatPulse = keyframes`
  50% {
    transform: scale(0.75);
    opacity: 0.25;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`

const MessageContentLoading = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;
`

const BeatDot = styled.span<{ $delay: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-text-1);
  animation: ${beatPulse} 0.875s ${({ $delay }) => $delay} infinite linear;
`

export default React.memo(PlaceholderBlock)
