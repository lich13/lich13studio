import { useAppInit } from '@renderer/hooks/useAppInit'
import { useShortcuts } from '@renderer/hooks/useShortcuts'
import { message, Modal } from 'antd'
import type { PropsWithChildren } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Box } from '../Layout'
import { getToastUtilities, initMessageApi } from './toast'

const OVERLAY_SELECTOR =
  '.ant-modal, .ant-drawer, .ant-select-dropdown, .ant-dropdown, .ant-popover, .ant-image-preview-wrap, [role="dialog"], dialog[open]'
const HIDDEN_OVERLAY_CLASS_RE = /(?:^|\s)ant-[\w-]+-hidden(?:\s|$)/

const isVisibleOverlay = (element: HTMLElement): boolean => {
  const target = element.classList.contains('ant-drawer')
    ? (element.querySelector<HTMLElement>('.ant-drawer-content-wrapper') ?? element)
    : element
  if (target instanceof HTMLDialogElement && !target.open) return false
  for (let current: HTMLElement | null = target; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false
    if (HIDDEN_OVERLAY_CLASS_RE.test(current.className)) return false
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  if (document.documentElement.getClientRects().length > 0) {
    return target.getClientRects().length > 0
  }
  return true
}

const hasVisibleDomOverlay = (): boolean =>
  typeof document !== 'undefined' &&
  Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR), isVisibleOverlay).some(Boolean)

type ElementItem = {
  id: string
  seq: number
  element: React.FC | React.ReactNode
  onCancel?: () => void
}

let nextElementSeq = 0
let onPop = () => {}
let onBack = (): boolean => false
let onPeekId = (): string | undefined => undefined
let onShow: (item: Omit<ElementItem, 'seq'>) => void = () => {}
let onHide: (id: string) => void = () => {}
let onHideAll = () => {}

interface Props {
  children?: React.ReactNode
}

const TopViewContainer: React.FC<Props> = ({ children }) => {
  const [elements, setElements] = useState<ElementItem[]>([])
  const elementsRef = useRef<ElementItem[]>([])
  elementsRef.current = elements

  const [modal, modalContextHolder] = Modal.useModal()
  const [messageApi, messageContextHolder] = message.useMessage()
  const { shortcuts } = useShortcuts()
  const enableQuitFullScreen = shortcuts.find((item) => item.key === 'exit_fullscreen')?.enabled

  useAppInit()

  useEffect(() => {
    window.modal = modal
    initMessageApi(messageApi)
    window.toast = getToastUtilities()
  }, [messageApi, modal])

  onPop = () => {
    const views = [...elementsRef.current]
    views.pop()
    elementsRef.current = views
    setElements(elementsRef.current)
  }

  onBack = () => {
    const top = elementsRef.current.at(-1)
    if (!top) {
      return false
    }
    if (top.onCancel) {
      top.onCancel()
      if (elementsRef.current.some((el) => el.seq === top.seq)) {
        elementsRef.current = elementsRef.current.filter((el) => el.seq !== top.seq)
        setElements(elementsRef.current)
      }
    } else {
      onPop()
    }
    return true
  }

  onPeekId = () => elementsRef.current.at(-1)?.id

  onShow = ({ element, id, onCancel }) => {
    let existing = elementsRef.current.find((el) => el.id === id)
    while (existing) {
      const targetSeq = existing.seq
      elementsRef.current = elementsRef.current.filter((el) => el.seq !== targetSeq)
      existing.onCancel?.()
      existing = elementsRef.current.find((el) => el.id === id)
    }
    const nextItem: ElementItem = {
      element,
      id,
      seq: ++nextElementSeq,
      onCancel
    }
    elementsRef.current = elementsRef.current.concat([nextItem])
    setElements(elementsRef.current)
  }

  onHide = (id: string) => {
    elementsRef.current = elementsRef.current.filter((el) => el.id !== id)
    setElements(elementsRef.current)
  }

  onHideAll = () => {
    setElements([])
    elementsRef.current = []
  }

  const FullScreenContainer: React.FC<PropsWithChildren> = useCallback(({ children }) => {
    return (
      <Box flex={1} position="absolute" w="100%" h="100%" className="topview-fullscreen-container">
        <Box position="absolute" w="100%" h="100%" onClick={() => onBack()} />
        {children}
      </Box>
    )
  }, [])

  useEffect(() => {
    const blockedEscEvents = new WeakSet<KeyboardEvent>()
    const hasOpenOverlay = () => elementsRef.current.length > 0 || hasVisibleDomOverlay()

    const isPlainEscape = (e: KeyboardEvent) =>
      e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey

    const handleCaptureKeyDown = (e: KeyboardEvent) => {
      if (!enableQuitFullScreen) return
      if (e.isComposing || e.keyCode === 229) return
      if (isPlainEscape(e) && (e.defaultPrevented || hasOpenOverlay())) {
        blockedEscEvents.add(e)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enableQuitFullScreen) return
      if (e.isComposing || e.keyCode === 229) return

      if (isPlainEscape(e) && !e.defaultPrevented && !blockedEscEvents.has(e) && !hasOpenOverlay()) {
        void window.api.setFullScreen(false)
      }
    }

    window.addEventListener('keydown', handleCaptureKeyDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleCaptureKeyDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enableQuitFullScreen])

  return (
    <>
      {children}
      {messageContextHolder}
      {modalContextHolder}
      {elements.map(({ element: Element, id, seq }) => (
        <FullScreenContainer key={`TOPVIEW_${id}_${seq}`}>
          {typeof Element === 'function' ? <Element /> : Element}
        </FullScreenContainer>
      ))}
    </>
  )
}

export const TopView = {
  show: (element: React.FC | React.ReactNode, id: string, onCancel?: () => void) => onShow({ element, id, onCancel }),
  hide: (id: string) => onHide(id),
  clear: () => onHideAll(),
  pop: () => onPop(),
  back: () => onBack(),
  peekId: () => onPeekId(),
  hasOpenOverlay: () => Boolean(onPeekId()) || hasVisibleDomOverlay()
}

export default TopViewContainer
