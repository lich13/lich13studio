import 'emoji-picker-element'

import TwemojiCountryFlagsWoff2 from '@renderer/assets/fonts/country-flag-fonts/TwemojiCountryFlags.woff2?url'
import { useTheme } from '@renderer/context/ThemeProvider'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import zh_CN from 'emoji-picker-element/i18n/zh_CN'
import type Picker from 'emoji-picker-element/picker'
import type { EmojiClickEvent } from 'emoji-picker-element/shared'
import dataZH from 'emoji-picker-element-data/zh/cldr/data.json?url'
import { type FC, useEffect, useRef } from 'react'

export interface EmojiPickerProps {
  onEmojiClick: (emoji: string) => void
}

const EmojiPickerContent: FC<EmojiPickerProps> = ({ onEmojiClick }) => {
  const { theme } = useTheme()
  const ref = useRef<Picker>(null)

  useEffect(() => {
    polyfillCountryFlagEmojis('Twemoji Mozilla', TwemojiCountryFlagsWoff2)
  }, [])

  useEffect(() => {
    const picker = ref.current
    if (picker) {
      picker.i18n = zh_CN
      picker.dataSource = dataZH
      picker.locale = 'zh'
    }
  }, [])

  useEffect(() => {
    const picker = ref.current
    if (!picker) return

    const handleEmojiClick = (event: EmojiClickEvent) => {
      event.stopPropagation()
      const { detail } = event
      const unicode = detail.unicode || ('unicode' in detail.emoji ? detail.emoji.unicode : '')
      onEmojiClick(unicode)
    }

    picker.addEventListener('emoji-click', handleEmojiClick)
    return () => {
      picker.removeEventListener('emoji-click', handleEmojiClick)
    }
  }, [onEmojiClick])

  // @ts-expect-error custom element emoji-picker
  return <emoji-picker ref={ref} class={theme === 'dark' ? 'dark' : 'light'} style={{ border: 'none' }} />
}

export default EmojiPickerContent
