import { Brain } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ReasoningTag = ({ size = 12, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#6372bd"
      icon={<Brain size={size} className="lucide-custom" />}
      tooltip={showTooltip ? t('models.type.reasoning') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.reasoning') : ''}
    </CustomTag>
  )
}
