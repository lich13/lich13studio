import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
describe('removed execution surfaces', () => {
  it('exports no MCP IPC, shim methods, Tauri commands or OpenAPI routes', () => {
    expect(read('src/preload/index.ts')).not.toMatch(/\bmcp\s*:/)
    expect(read('src/renderer/src/tauri-shim.ts')).not.toMatch(/\bmcp\s*:/)
    expect(read('src/main/ipc.ts')).not.toMatch(/Mcp_|MCPService/)
    expect(read('src-tauri/src/lib.rs')).not.toMatch(
      /test_mcp|check_mcp_connectivity|start_chat|test_provider|stream_gemini/
    )
    const spec = JSON.parse(read('src/main/apiServer/generated/openapi-spec.json'))
    expect(Object.keys(spec.paths).some((key) => /mcps?|claw/.test(key))).toBe(false)
    expect(read('src/main/apiServer/app.ts')).not.toMatch(/mcpRoutes|clawMcpRoutes/)
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
