import { lazy, memo, Suspense } from 'react'

import type { CodeEditorHandles, CodeEditorProps } from './CodeEditorImpl'

export type { CodeEditorHandles, CodeEditorProps }

const LazyCodeEditor = lazy(() => import('./CodeEditorImpl'))

const CodeEditor = (props: CodeEditorProps) => {
  return (
    <Suspense fallback={null}>
      <LazyCodeEditor {...props} />
    </Suspense>
  )
}

CodeEditor.displayName = 'CodeEditor'

export default memo(CodeEditor)
