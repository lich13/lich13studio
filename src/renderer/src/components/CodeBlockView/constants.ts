import SvgPreview from '@renderer/components/Preview/SvgPreview'
import { type ComponentType, lazy } from 'react'

const MermaidPreview = lazy(() => import('@renderer/components/Preview/MermaidPreview'))
const GraphvizPreview = lazy(() => import('@renderer/components/Preview/GraphvizPreview'))

/**
 * 特殊视图语言列表
 */
export const SPECIAL_VIEWS = ['mermaid', 'svg', 'dot', 'graphviz']

/**
 * 特殊视图组件映射表
 */
export const SPECIAL_VIEW_COMPONENTS: Record<string, ComponentType<any>> = {
  mermaid: MermaidPreview,
  svg: SvgPreview,
  dot: GraphvizPreview,
  graphviz: GraphvizPreview
} as const
