import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { type CitationMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'

import CitationsList from '../CitationsList'

function CitationBlock({ block }: { block: CitationMessageBlock }) {
  const formattedCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, block.id))
  const hasCitations = useMemo(() => {
    return (
      (formattedCitations && formattedCitations.length > 0) ||
      (block.knowledge && block.knowledge.length > 0) ||
      (block.memories && block.memories.length > 0)
    )
  }, [formattedCitations, block.knowledge, block.memories])

  if (block.status === MessageBlockStatus.PROCESSING) {
    return null
  }

  if (!hasCitations) {
    return null
  }

  return block.status === MessageBlockStatus.SUCCESS && formattedCitations.length > 0 ? (
    <CitationsList citations={formattedCitations} />
  ) : null
}

export default React.memo(CitationBlock)
