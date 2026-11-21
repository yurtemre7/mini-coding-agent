import type { Tool } from './tool'
import { Bash } from './tools/bash'
import { Edit, Read, Write } from './tools/files'
import { Glob, Grep } from './tools/search'

// Stable order keeps the provider's prompt cache prefix valid. MCP tools (sorted by name) are appended later.
export const builtinTools: Tool[] = [Read, Write, Edit, Glob, Grep, Bash]
