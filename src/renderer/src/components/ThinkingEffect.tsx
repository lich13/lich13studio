import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { motion } from 'motion/react'
import React, { useMemo } from 'react'
import styled from 'styled-components'

interface Props {
  isThinking: boolean
  thinkingTimeText: React.ReactNode
  content: string
  expanded: boolean
}

const extractRecentThinkingLines = (raw: string, isThinking: boolean, maxLines = 5): string[] => {
  if (!raw) return []
  let end = isThinking ? raw.lastIndexOf('\n') : raw.length
  if (end <= 0) return []
  const recent: string[] = []
  while (end > 0 && recent.length < maxLines) {
    const prevNewline = raw.lastIndexOf('\n', end - 1)
    const start = prevNewline === -1 ? 0 : prevNewline + 1
    const line = raw.slice(start, end)
    if (line.trim() !== '') {
      recent.push(line)
    }
    end = prevNewline
  }
  recent.reverse()
  return recent
}

const ThinkingEffect: React.FC<Props> = ({ isThinking, thinkingTimeText, content, expanded }) => {
  const showThinking = isThinking && !expanded

  const messages = useMemo(() => {
    if (!showThinking) return []
    return extractRecentThinkingLines(content || '', isThinking, 5)
  }, [content, isThinking, showThinking])

  const LINE_HEIGHT = 14

  const containerHeight = useMemo(() => {
    if (!showThinking || messages.length < 1) return 38
    return Math.min(68, Math.max(messages.length + 1, 2) * LINE_HEIGHT + 24)
  }, [showThinking, messages.length])

  return (
    <ThinkingContainer style={{ height: containerHeight }} className={expanded ? 'expanded' : ''}>
      <LoadingContainer>
        <motion.div variants={lightbulbVariants} animate={isThinking ? 'active' : 'idle'} initial="idle">
          <Lightbulb
            size={!showThinking || messages.length < 2 ? 20 : 26}
            style={{ transition: 'width 150ms, height 150ms' }}
          />
        </motion.div>
      </LoadingContainer>

      <TextContainer>
        <Title className={!showThinking || !messages.length ? 'showThinking' : ''}>{thinkingTimeText}</Title>

        {showThinking && messages.length > 0 && (
          <Content>
            <Messages
              style={{
                height: messages.length * LINE_HEIGHT
              }}
              initial={{
                y: -2
              }}
              animate={{
                y: -messages.length * LINE_HEIGHT - 2
              }}
              transition={{
                duration: 0.15,
                ease: 'linear'
              }}>
              {messages.map((message, index) => (
                <Message key={index}>{message}</Message>
              ))}
            </Messages>
          </Content>
        )}
      </TextContainer>
      <ArrowContainer className={expanded ? 'expanded' : ''}>
        <ChevronRight size={20} color="var(--color-text-3)" strokeWidth={1} />
      </ArrowContainer>
    </ThinkingContainer>
  )
}

const ThinkingContainer = styled.div`
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  border: 0.5px solid var(--color-border);
  transition: height 150ms, border-radius 150ms;
  pointer-events: none;
  user-select: none;
  &.expanded {
    border-radius: 10px 10px 0 0;
  }
`

const Title = styled.div`
  position: absolute;
  inset: 0 0 auto 0;
  font-size: 14px;
  line-height: 14px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  padding: 10px 0;
  z-index: 99;
  transition: padding-top 150ms;
  &.showThinking {
    padding-top: 12px;
  }
`

const LoadingContainer = styled.div`
  width: 50px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  padding-left: 5px;
  transition: width 150ms;
  > div {
    display: flex;
    justify-content: center;
    align-items: center;
  }
`

const TextContainer = styled.div`
  flex: 1;
  height: 100%;
  padding: 5px 0;
  overflow: hidden;
  position: relative;
`

const Content = styled.div`
  width: 100%;
  height: 100%;
  mask: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0%) 0%,
    rgb(0 0 0 / 0%) 35%,
    rgb(0 0 0 / 25%) 40%,
    rgb(0 0 0 / 100%) 90%,
    rgb(0 0 0 / 100%) 100%
  );
  position: relative;
`

const Messages = styled(motion.div)`
  width: 100%;
  position: absolute;
  top: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
`

const Message = styled.div`
  width: 100%;
  line-height: 14px;
  font-size: 11px;
  color: var(--color-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ArrowContainer = styled.div`
  width: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  color: var(--color-border);
  transition: transform 150ms;
  &.expanded {
    transform: rotate(90deg);
  }
`

export default ThinkingEffect
