import { z } from 'zod'
import type { AgentEvent, Decision, PermissionMode, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import type { FileState } from './filestate'
import type { ToolDef } from './provider/types'

export type JsonSchema = Record<string, unknown>

/** Plan-mode control, implemented by Permissions. */
export interface PlanControl {
  readonly mode: PermissionMode
  /** Leaves plan mode and returns to the mode that was active before it. */
  exitPlan(): PermissionMode
}

export const SUBAGENT_TYPES = ['Explore', 'general-purpose'] as const
export type SubagentType = (typeof SUBAGENT_TYPES)[number]
export interface SubagentRequest {
  type: SubagentType
  prompt: string
  callId: string // the Task tool-use id: becomes the parentId of everything the subagent shows
}

export interface ToolContext {
  /** Id of the tool call being run. */
  callId: string
  /** Emits an event to the frontend (todo list updates). */
  emit(event: AgentEvent): void
  plan?: PlanControl
  /** Runs a subagent to completion and returns its final text. Absent inside a subagent (depth 1). */
  runSubagent?(request: SubagentRequest): Promise<string>
  /** One-shot call to the fast model with no tools. Absent when no model is available. */
  summarize?(instruction: string, content: string): Promise<string>
  cwd: string // current working directory (Bash `cd` persists)
  root: string // workspace root
  files: FileState
  setCwd(dir: string): void
  signal: AbortSignal
  ask(request: PermissionRequest | PlanRequest | TrustRequest): Promise<Decision>
}

// `any` on purpose: a heterogeneous Tool[] needs a default that accepts every concrete Tool<I> (the readOnly callback is contravariant in I).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
