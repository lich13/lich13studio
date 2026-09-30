import type { Model } from '@renderer/types'
import { getModelPresentation } from '@renderer/utils/modelPresentation'
import { memo } from 'react'

import ModelTagsWithLabel from './ModelTagsWithLabel'

interface ModelIdWithTagsProps {
  model: Model
  fontSize?: number
  showIdentifier?: boolean
  style?: React.CSSProperties
}

const ModelIdWithTags = ({
  ref,
  model,
  fontSize = 14,
  showIdentifier = false,
  style
}: ModelIdWithTagsProps & { ref?: React.RefObject<HTMLDivElement> | null }) => {
  const presentation = getModelPresentation(model)
  const shouldShowIdentifier = showIdentifier && presentation.secondary

  return (
    <div
      ref={ref}
      className="flex min-w-0 items-center gap-2.5 font-semibold text-(--color-text) leading-[1.2]"
      style={{ fontSize, ...style }}>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1" title={model.id}>
        <span className="block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap leading-[1.3]">
          {presentation.primary}
        </span>
        {shouldShowIdentifier && (
          <span
            className="min-w-0 max-w-full shrink truncate font-mono text-(--color-text-3) text-[12px]! leading-[1.2]"
            title={model.id}>
            {model.id}
          </span>
        )}
      </div>
      <ModelTagsWithLabel model={model} size={11} style={{ flexShrink: 0 }} />
    </div>
  )
}

export default memo(ModelIdWithTags)
