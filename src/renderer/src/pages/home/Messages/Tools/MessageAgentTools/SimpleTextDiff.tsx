import { diffLines } from 'diff'
import { memo, useMemo } from 'react'

interface DiffRow {
  type: 'context' | 'added' | 'removed'
  oldNum?: number
  newNum?: number
  content: string
}

function splitChunkLines(value: string): string[] {
  if (!value) return []
  const lines = value.split('\n')
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

export const SimpleTextDiff = memo(function SimpleTextDiff({
  oldString,
  newString,
  diffStyle
}: {
  oldString: string
  newString: string
  diffStyle: 'unified' | 'split'
}) {
  const rows = useMemo(() => {
    const changes = diffLines(oldString ?? '', newString ?? '')
    const result: DiffRow[] = []
    let oldLine = 1
    let newLine = 1

    for (const part of changes) {
      const lines = splitChunkLines(part.value)
      for (const line of lines) {
        if (part.added) {
          result.push({ type: 'added', newNum: newLine++, content: line })
        } else if (part.removed) {
          result.push({ type: 'removed', oldNum: oldLine++, content: line })
        } else {
          result.push({ type: 'context', oldNum: oldLine++, newNum: newLine++, content: line })
        }
      }
    }

    return result
  }, [oldString, newString])

  if (diffStyle === 'split') {
    const leftRows = rows.filter((row) => row.type !== 'added')
    const rightRows = rows.filter((row) => row.type !== 'removed')

    return (
      <div className="grid grid-cols-2 gap-1 overflow-x-auto rounded-md border border-(--color-border-soft) bg-(--color-code-background) font-mono text-xs leading-5">
        <div className="min-w-0 border-(--color-border-soft) border-r">
          {leftRows.map((row, idx) => (
            <div
              key={`l-${idx}`}
              className={
                row.type === 'removed'
                  ? 'whitespace-pre-wrap break-all bg-red-500/15 px-2'
                  : 'whitespace-pre-wrap break-all px-2'
              }>
              <span className="mr-2 inline-block w-6 select-none text-right tabular-nums opacity-50">
                {row.oldNum ?? ''}
              </span>
              <span>{row.type === 'removed' ? '-' : ' '} </span>
              <span>{row.content}</span>
            </div>
          ))}
        </div>
        <div className="min-w-0">
          {rightRows.map((row, idx) => (
            <div
              key={`r-${idx}`}
              className={
                row.type === 'added'
                  ? 'whitespace-pre-wrap break-all bg-emerald-500/15 px-2'
                  : 'whitespace-pre-wrap break-all px-2'
              }>
              <span className="mr-2 inline-block w-6 select-none text-right tabular-nums opacity-50">
                {row.newNum ?? ''}
              </span>
              <span>{row.type === 'added' ? '+' : ' '} </span>
              <span>{row.content}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-(--color-border-soft) bg-(--color-code-background) font-mono text-xs leading-5">
      {rows.map((row, idx) => {
        const bgClass = row.type === 'added' ? 'bg-emerald-500/15' : row.type === 'removed' ? 'bg-red-500/15' : ''
        const prefix = row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '
        return (
          <div key={idx} className={`whitespace-pre-wrap break-all px-2 ${bgClass}`}>
            <span className="mr-1 inline-block w-6 select-none text-right tabular-nums opacity-50">
              {row.oldNum ?? ''}
            </span>
            <span className="mr-2 inline-block w-6 select-none text-right tabular-nums opacity-50">
              {row.newNum ?? ''}
            </span>
            <span>{prefix} </span>
            <span>{row.content}</span>
          </div>
        )
      })}
    </div>
  )
})
