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

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORT_LEVELS)[number]
export const DEFAULT_EFFORT: Effort = 'medium'
/** CLI flag value -> Effort; undefined input means the default, an unknown string is undefined. */
export const parseEffort = (s?: string): Effort | undefined => (s === undefined ? DEFAULT_EFFORT : EFFORT_LEVELS.find((e) => e === s))

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
export type KeySource = 'env' | 'keychain' | 'file' | 'dotenv'
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
  /** Seq of the last event folded into this state; a batch with seq <= this is already included and must be ignored. */
  seq: number
}

/** Everything the reducer understands: agent events plus the events main adds for things only it knows. */
export type ViewEvent = AgentEvent | { type: 'user_message'; text: string } | { type: 'rewind' } | { type: 'clear' } | { type: 'session'; workspace: string | null; mode: PermissionMode }

/** One IPC message: consecutive events, `seq` = the seq of the last one. */
export interface EventBatch {
  seq: number
  events: ViewEvent[]
}

/** A saved chat of the current workspace. */
export interface SessionInfo {
  id: string
  title: string
  updated: number // ms since epoch
  messageCount: number
}

/** Never contains a key: the renderer only learns whether one exists. */
export interface SettingsInfo {
  provider: ProviderId
  model: string
  effort: Effort
  hasKey: Record<ProviderId, boolean>
  keySource: Record<ProviderId, KeySource | null>
}

export interface IpcContract {
  invoke: {
    'app:getInfo': { args: []; result: AppInfo }
    'session:send': { args: [text: string]; result: void }
    'session:abort': { args: []; result: void }
    'session:getState': { args: []; result: ViewState }
    /** A slash command line such as "/rewind" or "/mode plan"; its output arrives as notice events. */
    'session:command': { args: [line: string]; result: void }
    'workspace:select': { args: []; result: void }
    /** Recently opened workspaces, newest first (folders that vanished are dropped). */
    'workspace:recent': { args: []; result: string[] }
    /** Only a path from the recent list is opened; anything else is refused. */
    'workspace:open': { args: [path: string]; result: void }
    /** Saved chats of the current workspace, newest first. */
    'session:list': { args: []; result: SessionInfo[] }
    /** Resume a listed chat: main rebuilds the view and keeps appending to its file. */
    'session:open': { args: [id: string]; result: void }
    'session:new': { args: []; result: void }
    'settings:get': { args: []; result: SettingsInfo }
    'settings:setKey': { args: [provider: ProviderId, key: string]; result: SettingsInfo }
    'settings:update': { args: [patch: { provider?: ProviderId; model?: string; effort?: Effort }]; result: SettingsInfo }
    /** The provider's model ids (the key stays in main). On failure `models` is the defaults and `error` says why; a 401/403 error means the key was rejected. */
    'settings:models': { args: [provider: ProviderId]; result: { models: string[]; error?: string; rejected?: boolean } }
    'prompt:answer': { args: [id: string, decision: Decision]; result: void }
  }
  events: {
    'agent:events': EventBatch
    'prompt:request': { id: string; request: PromptRequest }
  }
}

// Record types make a missing or renamed channel a compile error; the preload uses these as runtime allowlists.
const INVOKE: Record<keyof IpcContract['invoke'], true> = { 'app:getInfo': true, 'session:send': true, 'session:abort': true, 'session:getState': true, 'session:command': true, 'workspace:select': true, 'workspace:recent': true, 'workspace:open': true, 'session:list': true, 'session:open': true, 'session:new': true, 'settings:get': true, 'settings:setKey': true, 'settings:update': true, 'settings:models': true, 'prompt:answer': true }
const EVENTS: Record<keyof IpcContract['events'], true> = { 'agent:events': true, 'prompt:request': true }
export const INVOKE_CHANNELS = Object.keys(INVOKE) as (keyof IpcContract['invoke'])[]
export const EVENT_CHANNELS = Object.keys(EVENTS) as (keyof IpcContract['events'])[]

export type McaApi = {
  invoke<K extends keyof IpcContract['invoke']>(channel: K, ...args: IpcContract['invoke'][K]['args']): Promise<IpcContract['invoke'][K]['result']>
  /** Returns an unsubscribe function. */
  on<K extends keyof IpcContract['events']>(channel: K, cb: (payload: IpcContract['events'][K]) => void): () => void
}
