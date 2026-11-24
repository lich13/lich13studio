// Tool registry loader
// Import all tool definitions to register them

import './attachmentTool'
import './windowCaptureTool'
import './mentionModelsTool'
import './newTopicTool'
import './quickPhrasesTool'
import './thinkingTool'
import './urlContextTool'

// Export registry functions
export { getAllTools, getTool, getToolsForScope, registerTool } from '../types'
