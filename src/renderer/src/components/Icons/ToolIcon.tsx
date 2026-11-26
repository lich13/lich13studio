import { Wrench } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'

const ToolIcon: FC<HTMLAttributes<HTMLSpanElement>> = ({ className, ...props }) => {
  return (
    <span {...props} className={`inline-flex items-center justify-center ${className ?? ''}`.trim()}>
      <Wrench size={14} className="lucide-custom" />
    </span>
  )
}

export default ToolIcon
