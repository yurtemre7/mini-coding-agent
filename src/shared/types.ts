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

// ---------- Desktop view state and IPC ----------

export type ProviderId = 'anthropic' | 'openrouter'
export type PromptRequest = PermissionRequest | PlanRequest | TrustRequest

/** What the renderer shows. Events reduce into it (src/shared/reducer.ts); main owns the truth, the renderer rebuilds from a snapshot. */
export type Item =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string; parentId?: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; parentId?: string; done: boolean; result?: string; isError?: boolean }
  | { kind: 'notice'; level: 'info' | 'warn' | 'error'; message: string }

export interface ViewState {
  items: Item[]
  todos: Todo[]
  usage?: { contextTokens: number; contextWindow: number }
  mode: PermissionMode
  provider: ProviderId
  model: string
  workspace: string | null
  busy: boolean
  pending: { id: string; request: PromptRequest } | null
}

/** Everything the reducer understands: agent events plus the events main adds for things only it knows. */
export type ViewEvent = AgentEvent | { type: 'user_message'; text: string } | { type: 'rewind' } | { type: 'clear' }

/** Never contains a key: the renderer only learns whether one exists. */
export interface SettingsInfo {
  provider: ProviderId
  model: string
  hasKey: Record<ProviderId, boolean>
}

export interface IpcContract {
  invoke: {
    'app:getInfo': { args: []; result: AppInfo }
    'session:send': { args: [text: string]; result: ViewState }
    'session:abort': { args: []; result: void }
    'session:getState': { args: []; result: ViewState }
    /** A slash command line such as "/rewind" or "/mode plan"; its output arrives as notice events. */
    'session:command': { args: [line: string]; result: ViewState }
    'workspace:select': { args: []; result: ViewState }
    'settings:get': { args: []; result: SettingsInfo }
    'settings:setKey': { args: [provider: ProviderId, key: string]; result: SettingsInfo }
    'settings:update': { args: [patch: { provider?: ProviderId; model?: string }]; result: SettingsInfo }
    'prompt:answer': { args: [id: string, decision: Decision]; result: void }
  }
  events: {
    'agent:events': ViewEvent[]
    'prompt:request': { id: string; request: PromptRequest }
  }
}

export const EVENT_CHANNELS = ['agent:events', 'prompt:request'] as const satisfies readonly (keyof IpcContract['events'])[]

export type McaApi = {
  invoke<K extends keyof IpcContract['invoke']>(channel: K, ...args: IpcContract['invoke'][K]['args']): Promise<IpcContract['invoke'][K]['result']>
  /** Returns an unsubscribe function. */
  on<K extends keyof IpcContract['events']>(channel: K, cb: (payload: IpcContract['events'][K]) => void): () => void
}
