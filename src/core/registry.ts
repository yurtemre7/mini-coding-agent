import type { Tool } from './tool'
import { Read } from './tools/files'

// Stable order keeps the provider's prompt cache prefix valid. MCP tools (sorted by name) are appended later.
export const builtinTools: Tool[] = [Read]
