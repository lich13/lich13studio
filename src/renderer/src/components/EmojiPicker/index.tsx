import { type FC, lazy, Suspense } from 'react'

import type { EmojiPickerProps } from './EmojiPickerContent'

const LazyEmojiPickerContent = lazy(() => import('./EmojiPickerContent'))

const EmojiPicker: FC<EmojiPickerProps> = ({ onEmojiClick }) => {
  return (
    <Suspense fallback={<div style={{ width: 344, height: 400 }} />}>
      <LazyEmojiPickerContent onEmojiClick={onEmojiClick} />
    </Suspense>
  )
}

export default EmojiPicker
