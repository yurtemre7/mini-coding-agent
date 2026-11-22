/** One file the agent changed, as the review panel and `/diff` list it. Paths are workspace-relative with forward slashes. */
export interface ChangeSummary {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  binary: boolean
  tooLarge: boolean
}

/** One entry of a provider's model list. `free` marks a model that costs nothing (OpenRouter's `:free` variants). */
export interface ModelInfo {
  id: string
  free?: boolean
}

/** Where the source lives; the About tab links here. */
export const REPO_URL = 'https://github.com/yurtemre7/mini-coding-agent'

export interface AppInfo {
  name: string
  shortName: string
  version: string
  platform: NodeJS.Platform
  electronVersion: string
  license: string
  repoUrl: string
}

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
  hooks?: string[] // project hooks that trusting would enable
  mcp?: string[] // project MCP servers (commands) that trusting would start
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
  | { type: 'attention'; reason: 'loop' | 'long' | 'prompt'; message: string } // the user may be away: a frontend can notify them
  | { type: 'usage'; contextTokens: number; contextWindow: number; /** this request only; absent on estimates */ inputTokens?: number; outputTokens?: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'turn_end'; reason: 'done' | 'aborted' | 'error' | 'max_iterations' }
  /** Files the agent changed: in the turn that just ended, and in the whole chat. Summaries only; diffs are fetched on demand. */
  | { type: 'changes'; turn: ChangeSummary[]; total: ChangeSummary[] }

// ---------- Desktop view state and IPC ----------

export type ProviderId = 'anthropic' | 'openrouter'
export type KeySource = 'env' | 'keychain' | 'file' | 'dotenv'
/** A file or pasted image sent with a prompt. `data` is base64. */
export interface Attachment {
  name: string
  mime: string
  data: string
}
export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export type PromptRequest = PermissionRequest | PlanRequest | TrustRequest

/** What the renderer shows. Events reduce into it (src/shared/reducer.ts); main owns the truth, the renderer rebuilds from a snapshot. */
export type Item =
  | { kind: 'user'; text: string; attachments?: string[] }
  | { kind: 'text'; text: string; parentId?: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; parentId?: string; done: boolean; result?: string; isError?: boolean }
  | { kind: 'notice'; level: 'info' | 'warn' | 'error'; message: string }

export interface ViewState {
  items: Item[]
  todos: Todo[]
  changes: { turn: ChangeSummary[]; total: ChangeSummary[] }
  /** totalIn/totalOut: tokens sent and received by this chat's requests since it was opened (subagent requests are not counted) */
  usage?: { contextTokens: number; contextWindow: number; totalIn: number; totalOut: number }
  mode: PermissionMode
  provider: ProviderId
  model: string
  workspace: string | null
  /** One line per MCP server: connected, failed or unsupported. */
  mcp: string[]
  busy: boolean
  pending: { id: string; request: PromptRequest } | null
  /** Seq of the last event folded into this state; a batch with seq <= this is already included and must be ignored. */
  seq: number
}

/** Everything the reducer understands: agent events plus the events main adds for things only it knows. */
export type ViewEvent = AgentEvent | { type: 'user_message'; text: string; attachments?: string[] } | { type: 'rewind' } | { type: 'clear' } | { type: 'session'; workspace: string | null; mode: PermissionMode; mcp?: string[] }

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
/** A slash command offered by autocomplete. */
export interface CommandInfo {
  name: string
  description: string
  custom: boolean
}

export interface SettingsInfo {
  provider: ProviderId
  model: string
  effort: Effort
  /** desktop notifications when the model looks stuck or something waits for the user */
  notifications: boolean
  /** the user's own instructions for the model; empty = none */
  systemPrompt: string
  /** use systemPrompt instead of the built-in prompt */
  systemReplace: boolean
  defaultSystemPrompt: string
  hasKey: Record<ProviderId, boolean>
  keySource: Record<ProviderId, KeySource | null>
}

export interface IpcContract {
  invoke: {
    'app:getInfo': { args: []; result: AppInfo }
    'session:send': { args: [text: string, attachments?: Attachment[]]; result: void }
    'session:abort': { args: []; result: void }
    'session:getState': { args: []; result: ViewState }
    /** A slash command line such as "/rewind" or "/mode plan"; its output arrives as notice events. */
    'session:command': { args: [line: string]; result: void }
    /** The unified diff of one file the agent changed (`path` is a ChangeSummary path); `scope` is the newest turn or the whole chat. */
    'changes:diff': { args: [scope: 'turn' | 'all', path: string]; result: string }
    /** Puts one changed file back to its state before the agent touched it. Refused while a turn runs. */
    'changes:revert': { args: [scope: 'turn' | 'all', path: string]; result: void }
    'workspace:select': { args: []; result: void }
    /** Recently opened workspaces, newest first (folders that vanished are dropped). */
    'workspace:recent': { args: []; result: string[] }
    /** Only a path from the recent list is opened; anything else is refused. */
    'workspace:open': { args: [path: string]; result: void }
    'workspace:forget': { args: [path: string]; result: void }
    /** Saved chats of the current workspace, newest first. */
    'session:list': { args: []; result: SessionInfo[] }
    /** Resume a listed chat: main rebuilds the view and keeps appending to its file. */
    'session:open': { args: [id: string]; result: void }
    'session:new': { args: []; result: void }
    /** Deletes a saved chat of this workspace (idle only). */
    'session:delete': { args: [id: string]; result: void }
    /** Asks where to save, then writes the chat as Markdown. Resolves to the saved path, or null when cancelled. */
    'session:export': { args: [id: string]; result: string | null }
    /** Shows the workspace folder in Finder. */
    'workspace:reveal': { args: []; result: void }
    'settings:get': { args: []; result: SettingsInfo }
    'settings:setKey': { args: [provider: ProviderId, key: string]; result: SettingsInfo }
    'settings:update': { args: [patch: { provider?: ProviderId; model?: string; effort?: Effort; notifications?: boolean; systemPrompt?: string; systemReplace?: boolean }]; result: SettingsInfo }
    /** The provider's model ids (the key stays in main). On failure `models` is the defaults and `error` says why; a 401/403 error means the key was rejected. */
    'settings:models': { args: [provider: ProviderId]; result: { models: ModelInfo[]; error?: string; rejected?: boolean } }
    'prompt:answer': { args: [id: string, decision: Decision]; result: void }
    /** Slash commands of the current workspace (built-in and custom) for autocomplete. */
    'commands:list': { args: []; result: CommandInfo[] }
  }
  events: {
    'agent:events': EventBatch
    'prompt:request': { id: string; request: PromptRequest }
  }
}

// Record types make a missing or renamed channel a compile error; the preload uses these as runtime allowlists.
const INVOKE: Record<keyof IpcContract['invoke'], true> = { 'app:getInfo': true, 'session:send': true, 'session:abort': true, 'session:getState': true, 'session:command': true, 'changes:diff': true, 'changes:revert': true, 'workspace:select': true, 'workspace:recent': true, 'workspace:open': true, 'workspace:forget': true, 'session:list': true, 'session:open': true, 'session:new': true, 'session:delete': true, 'session:export': true, 'workspace:reveal': true, 'settings:get': true, 'settings:setKey': true, 'settings:update': true, 'settings:models': true, 'prompt:answer': true, 'commands:list': true }
const EVENTS: Record<keyof IpcContract['events'], true> = { 'agent:events': true, 'prompt:request': true }
export const INVOKE_CHANNELS = Object.keys(INVOKE) as (keyof IpcContract['invoke'])[]
export const EVENT_CHANNELS = Object.keys(EVENTS) as (keyof IpcContract['events'])[]

export type McaApi = {
  invoke<K extends keyof IpcContract['invoke']>(channel: K, ...args: IpcContract['invoke'][K]['args']): Promise<IpcContract['invoke'][K]['result']>
  /** Returns an unsubscribe function. */
  on<K extends keyof IpcContract['events']>(channel: K, cb: (payload: IpcContract['events'][K]) => void): () => void
}

/** Context the agent injects into a user message (date, git, instruction files, hook output). Never shown as something the user typed. */
export const isReminder = (text: string): boolean => text.startsWith('<system-reminder>')
