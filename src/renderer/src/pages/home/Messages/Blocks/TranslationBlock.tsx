import type { TranslationMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: TranslationMessageBlock
}

const TranslationBlock: React.FC<Props> = () => {
  return null
}

export default React.memo(TranslationBlock)
