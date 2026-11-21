export interface AppInfo {
  name: string
  shortName: string
  version: string
  platform: NodeJS.Platform
  electronVersion: string
}

// Minimal versions: later milestones (permissions, plan mode, trust, todos) extend these.
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface PermissionRequest {
  kind: 'permission'
  toolName: string
  input: unknown
  reason?: string // why a prompt is needed (protected path, outside workspace, ...)
  suggestion?: string // the rule "Yes for this session" would store
}
export interface PlanRequest {
  kind: 'plan'
  plan: string
}
export interface TrustRequest {
  kind: 'trust'
  workspace: string
  rules?: string[] // project allow rules that trusting would enable
}
export interface Decision {
  allow: boolean
  scope?: 'once' | 'session'
  feedback?: string
}

export type AgentEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta'; text: string; parentId?: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown; parentId?: string }
  | { type: 'tool_end'; id: string; result: string; isError: boolean }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'usage'; contextTokens: number; contextWindow: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'turn_end'; reason: 'done' | 'aborted' | 'error' | 'max_iterations' }
