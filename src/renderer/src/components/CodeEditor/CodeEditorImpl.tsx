import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import type { BasicSetupOptions, Extension } from '@uiw/react-codemirror'
import CodeMirror, { Annotation, EditorView } from '@uiw/react-codemirror'
import { diffChars } from 'diff'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { loadCmTheme } from 'virtual:cm-themes'

import { useBlurHandler, useHeightListener, useLanguageExtensions, useSaveKeymap, useScrollToLine } from './hooks'

const External = Annotation.define<boolean>()

export interface CodeEditorHandles {
  save?: () => void
  scrollToLine?: (lineNumber: number, options?: { highlight?: boolean }) => void
  getContent?: () => string
}

export interface CodeEditorProps {
  ref?: React.RefObject<CodeEditorHandles | null>
  value: string
  placeholder?: string | HTMLElement
  language: string
  onSave?: (newContent: string) => void
  onChange?: (newContent: string) => void
  onBlur?: (newContent: string) => void
  onHeightChange?: (scrollHeight: number) => void
  height?: string
  maxHeight?: string
  minHeight?: string
  options?: {
    stream?: boolean
    lint?: boolean
    keymap?: boolean
  } & BasicSetupOptions
  extensions?: Extension[]
  fontSize?: number
  style?: React.CSSProperties
  className?: string
  editable?: boolean
  readOnly?: boolean
  expanded?: boolean
  wrapped?: boolean
}

const CodeEditorImpl = ({
  ref,
  value,
  placeholder,
  language,
  onSave,
  onChange,
  onBlur,
  onHeightChange,
  height,
  maxHeight,
  minHeight,
  options,
  extensions,
  fontSize: customFontSize,
  style,
  className,
  editable = true,
  readOnly = false,
  expanded = true,
  wrapped = true
}: CodeEditorProps) => {
  const { fontSize: _fontSize, codeShowLineNumbers: _lineNumbers, codeEditor } = useSettings()
  const enableKeymap = useMemo(() => options?.keymap ?? codeEditor.keymap, [options?.keymap, codeEditor.keymap])

  const basicSetup = useMemo(() => {
    return {
      lineNumbers: _lineNumbers,
      ...(codeEditor as BasicSetupOptions),
      ...(options as BasicSetupOptions)
    }
  }, [codeEditor, _lineNumbers, options])

  const fontSize = useMemo(() => customFontSize ?? _fontSize - 1, [customFontSize, _fontSize])

  const { activeCmThemeName } = useCodeStyle()
  const [loadedCmTheme, setLoadedCmTheme] = useState<{ name: string; ext: Extension } | null>(null)
  useEffect(() => {
    if (activeCmThemeName === 'light' || activeCmThemeName === 'dark') {
      return
    }
    let cancelled = false
    void loadCmTheme(activeCmThemeName).then((ext) => {
      if (!cancelled && ext) {
        setLoadedCmTheme({ name: activeCmThemeName, ext })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeCmThemeName])
  const activeCmTheme = useMemo(() => {
    if (activeCmThemeName === 'light' || activeCmThemeName === 'dark') {
      return activeCmThemeName
    }
    if (loadedCmTheme?.name === activeCmThemeName) {
      return loadedCmTheme.ext
    }
    return activeCmThemeName.toLowerCase().includes('dark') ? 'dark' : 'light'
  }, [activeCmThemeName, loadedCmTheme])
  const initialContent = useRef(options?.stream ? (value ?? '').trimEnd() : (value ?? ''))
  const editorViewRef = useRef<EditorView | null>(null)

  const langExtensions = useLanguageExtensions(language, options?.lint)

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.doc.toString() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  const getContent = useCallback(() => {
    return editorViewRef.current?.state.doc.toString() ?? ''
  }, [])

  useEffect(() => {
    if (!editorViewRef.current) return

    const newContent = options?.stream ? (value ?? '').trimEnd() : (value ?? '')
    const currentDoc = editorViewRef.current.state.doc.toString()

    const changes = prepareCodeChanges(currentDoc, newContent)

    if (changes && changes.length > 0) {
      editorViewRef.current.dispatch({
        changes,
        annotations: [External.of(true)]
      })
    }
  }, [options?.stream, value])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: enableKeymap })
  const blurExtension = useBlurHandler({ onBlur })
  const heightListenerExtension = useHeightListener({ onHeightChange })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      ...langExtensions,
      ...(wrapped ? [EditorView.lineWrapping] : []),
      saveKeymapExtension,
      blurExtension,
      heightListenerExtension
    ].flat()
  }, [extensions, langExtensions, wrapped, saveKeymapExtension, blurExtension, heightListenerExtension])

  const scrollToLine = useScrollToLine(editorViewRef)

  useImperativeHandle(
    ref,
    () => ({
      save: handleSave,
      scrollToLine,
      getContent
    }),
    [handleSave, scrollToLine, getContent]
  )

  return (
    <CodeMirror
      value={initialContent.current}
      placeholder={placeholder}
      width="100%"
      height={expanded ? undefined : height}
      maxHeight={expanded ? undefined : maxHeight}
      minHeight={minHeight}
      editable={editable}
      readOnly={readOnly}
      theme={activeCmTheme as any}
      extensions={customExtensions}
      onCreateEditor={(view: EditorView) => {
        editorViewRef.current = view
        onHeightChange?.(view.scrollDOM?.scrollHeight ?? 0)
      }}
      onChange={(nextValue, viewUpdate) => {
        if (onChange && viewUpdate.docChanged) onChange(nextValue)
      }}
      basicSetup={{
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        rectangularSelection: true,
        crosshairCursor: true,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: true,
        closeBracketsKeymap: enableKeymap,
        searchKeymap: enableKeymap,
        foldKeymap: enableKeymap,
        completionKeymap: enableKeymap,
        lintKeymap: enableKeymap,
        ...basicSetup
      }}
      style={{
        fontSize,
        marginTop: 0,
        borderRadius: 'inherit',
        ...style
      }}
      className={`code-editor ${className ?? ''}`}
    />
  )
}

CodeEditorImpl.displayName = 'CodeEditorImpl'

function prepareCodeChanges(oldCode: string, newCode: string) {
  if (oldCode === newCode) {
    return []
  }
  if (newCode.startsWith(oldCode)) {
    return [{ from: oldCode.length, to: oldCode.length, insert: newCode.slice(oldCode.length) }]
  }

  const diffResult = diffChars(oldCode, newCode)
  const changes: { from: number; to: number; insert: string }[] = []
  let offset = 0

  for (const part of diffResult) {
    if (part.added) {
      changes.push({
        from: offset,
        to: offset,
        insert: part.value
      })
    } else if (part.removed) {
      changes.push({
        from: offset,
        to: offset + part.value.length,
        insert: ''
      })
      offset += part.value.length
    } else {
      offset += part.value.length
    }
  }

  return changes
}

export default memo(CodeEditorImpl)
