import { GraphvizPreview, MermaidPreview, SvgPreview } from '@renderer/components/Preview'
import type { ComponentType } from 'react'

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
