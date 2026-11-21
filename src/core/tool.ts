import { z } from 'zod'
import type { Decision, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import type { FileState } from './filestate'
import type { ToolDef } from './provider/types'

export type JsonSchema = Record<string, unknown>

export interface ToolContext {
  cwd: string // current working directory (Bash `cd` persists)
  root: string // workspace root
  files: FileState
  setCwd(dir: string): void
  signal: AbortSignal
  ask(request: PermissionRequest | PlanRequest | TrustRequest): Promise<Decision>
}

export interface Tool<I = any> {
  name: string
  description: string
  schema: z.ZodType<I> | JsonSchema // raw JSON Schema is what MCP tools provide
  readOnly: boolean | ((input: I) => boolean) // a function lets Bash classify per command
  run(input: I, ctx: ToolContext): Promise<string>
}

export const isZod = (s: Tool['schema']): s is z.ZodType => typeof (s as z.ZodType).safeParse === 'function'

export function toToolDef(tool: Tool): ToolDef {
  const input_schema = isZod(tool.schema) ? (z.toJSONSchema(tool.schema) as JsonSchema) : (tool.schema as JsonSchema)
  return { name: tool.name, description: tool.description, input_schema }
}

/** Keeps the head and the tail (errors and summaries usually live at the end) and cuts the middle. */
export function truncate(text: string, max = 30_000): string {
  if (text.length <= max) return text
  const head = Math.ceil(max / 2)
  const tail = max - head
  return `${text.slice(0, head)}\n\n... [${text.length - max} characters truncated] ...\n\n${text.slice(text.length - tail)}`
}
