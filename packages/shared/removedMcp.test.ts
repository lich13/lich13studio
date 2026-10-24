import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
describe('removed execution surfaces', () => {
  it('exports no MCP IPC, shim methods, Tauri commands', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/preload/index.ts'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'src/main/ipc.ts'))).toBe(false)
    expect(read('src/renderer/src/tauri-shim.ts')).not.toMatch(/\bmcp\s*:/)
    expect(read('src-tauri/src/lib.rs')).not.toMatch(
      /test_mcp|check_mcp_connectivity|start_chat|test_provider|stream_gemini/
    )
  })
  it('historical records contain no execution or approval hooks and native agent web tools are enabled', () => {
    expect(read('src/renderer/src/pages/home/Messages/Tools/HistoricalToolRecord.tsx')).not.toMatch(
      /window\.api|useToolApproval|onClick|abortTool/
    )
    expect(read('src/renderer/src/pages/home/Messages/Tools/MessageTools.tsx')).toContain(
      "tool.name.startsWith('mcp__')"
    )
    expect(read('packages/shared/agents/claudecode/constants.ts')).toMatch(/GLOBALLY_DISALLOWED_TOOLS[^=]*= \[\]/)
  })
})
