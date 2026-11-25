export type ToolType = 'builtin' | 'provider' | 'mcp'

export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

export interface ToolJsonSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

export interface BuiltinTool extends BaseTool {
  inputSchema: ToolJsonSchema
  type: 'builtin'
}

export interface HistoricalTool extends BaseTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: ToolJsonSchema
  outputSchema?: ToolJsonSchema
  isBuiltIn?: boolean
  type: 'mcp'
}
