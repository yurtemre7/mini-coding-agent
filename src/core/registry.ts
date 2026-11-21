import type { Tool } from './tool'
import { Bash } from './tools/bash'
import { Edit, Read, Write } from './tools/files'
import { ExitPlanMode } from './tools/plan'
import { Glob, Grep } from './tools/search'
import { Task } from './tools/task'
import { TodoWrite } from './tools/todo'
import { WebFetch } from './tools/web'

// Stable order keeps the provider's prompt cache prefix valid. MCP tools (sorted by name) are appended later.
export const builtinTools: Tool[] = [Read, Write, Edit, Glob, Grep, Bash, TodoWrite, ExitPlanMode, Task, WebFetch]
