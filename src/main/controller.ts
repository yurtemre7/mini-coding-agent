import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentSession, type Frontend } from '../core/agent'
import { BUILTIN_INFO, loadCommands, parseInput, runCommand } from '../core/commands'
import { diffFor, summarizeChanges } from '../core/changes'
import { getKey, keySource, setKey } from '../core/credentials'
import { createPermissions, type Permissions } from '../core/permissions'
import { DEFAULT_MODELS, FAST_MODEL } from '../core/provider/models'
import { createProvider, PROVIDER_IDS } from '../core/provider/factory'
import { ProviderError } from '../core/provider/retry'
import type { Block, ModelProvider } from '../core/provider/types'
import { builtinTools } from '../core/registry'
import { exportMarkdown } from '../core/export'
import { deleteSession, listSessions, loadSession, parseTranscript, sessionDir, Transcript } from '../core/session'
import { buildReminder } from '../core/context'
import { describeStatus, McpManager } from '../core/mcp'
import { forgetWorkspace, isTrusted, loadPrefs, recentWorkspaces, rememberWorkspace, savePrefs, trustWorkspace } from '../core/trust'
import { reduce, emptyView, messagesToEvents } from '../shared/reducer'
import { DEFAULT_EFFORT, EFFORT_LEVELS, type Attachment, type CommandInfo, IMAGE_MIMES, type Decision, type Effort, type KeySource, type ModelInfo, type PromptRequest, type ProviderId, type SessionInfo, type SettingsInfo, type ViewEvent, type ViewState } from '../shared/types'

const MAX_SYSTEM_PROMPT = 20_000
export const DEFAULT_SYSTEM_PROMPT = "You are MCA, a coding agent in a desktop app. Use the available tools to inspect the project, and answer concisely."

export interface ControllerDeps {
  /** Every state change, in order. The ipc layer batches these. */
  emit(e: ViewEvent, seq: number): void
  /** Show a prompt now (not batched). */
  prompt(p: { id: string; request: PromptRequest }): void
  /** The user may be away: a prompt waits, the model looks stuck, or a turn runs long. The frontend decides how to tell them. */
  notify?(message: string): void
  /** Test hooks: how long a prompt waits, and how long a turn runs, before notifying. */
  timings?: { promptMs?: number; longTurnMs?: number }
  home?: string
  keys?: { get(p: ProviderId): Promise<string | null>; set(p: ProviderId, key: string): Promise<void>; source?(p: ProviderId): Promise<KeySource | null> }
  /** Tests swap in a FakeProvider. */
  makeProvider?: (id: ProviderId, key: string) => ModelProvider
}

/**
 * The desktop's Frontend + session owner (the counterpart of src/cli/ui.ts runInteractive). No electron imports.
 * Provider and model can change between turns without losing history: the session talks to `proxy`, which reads the current choice.
 */
export class Controller {
  private view = { ...emptyView() }
  private seq = 0
  private provider: ProviderId = 'anthropic'
  private model: string = DEFAULT_MODELS.anthropic.main
  private effort: Effort = DEFAULT_EFFORT
  private notifications = true
  private systemPrompt = ''
  private systemReplace = false
  private workspace: string | null = null
  private session?: AgentSession
  private perms?: Permissions
  private pending: ViewState['pending'] = null
  private resolvePending?: (d: Decision) => void
  private cache?: { id: ProviderId; p: ModelProvider }
  private modelLists = new Map<ProviderId, ModelInfo[]>()
  private keys: NonNullable<ControllerDeps['keys']>

  constructor(private d: ControllerDeps) {
    this.keys = d.keys ?? { get: getKey, set: setKey, source: keySource }
    const currentProvider = () => this.provider
    this.proxy = {
      get id() {
        return currentProvider()
      },
      contextWindow: async () => (await this.current()).contextWindow(this.model),
      stream: (req) => this.stream(req)
    }
  }

  private apply(e: ViewEvent): void {
    this.view = reduce(this.view, e)
    if (e.type === 'turn_end') this.clearPending()
    this.d.emit(e, ++this.seq)
  }

  private notice(level: 'info' | 'warn' | 'error', message: string): void {
    this.apply({ type: 'notice', level, message })
  }

  getState(): ViewState {
    return { ...this.view, mode: this.perms?.mode ?? this.view.mode, provider: this.provider, model: this.model, workspace: this.workspace, pending: this.pending, seq: this.seq }
  }

  async getSettings(): Promise<SettingsInfo> {
    const hasKey = { anthropic: false, openrouter: false }
    const source: SettingsInfo['keySource'] = { anthropic: null, openrouter: null }
    for (const id of PROVIDER_IDS) {
      hasKey[id] = !!(await this.keys.get(id))
      source[id] = hasKey[id] ? ((await this.keys.source?.(id)) ?? null) : null
    }
    return { provider: this.provider, model: this.model, effort: this.effort, notifications: this.notifications, systemPrompt: this.systemPrompt, systemReplace: this.systemReplace, defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT, hasKey, keySource: source }
  }

  /** Model ids for the picker, cached per provider for the session. A failure returns the defaults plus the reason; `rejected` = the key was refused. */
  async models(id: ProviderId): Promise<{ models: ModelInfo[]; error?: string; rejected?: boolean }> {
    const hit = this.modelLists.get(id)
    if (hit) return { models: hit }
    try {
      const key = await this.keys.get(id)
      if (!key) throw new Error(`No API key for ${id}. Add one in Settings.`)
      const models = (await (this.d.makeProvider ?? createProvider)(id, key).listModels?.()) ?? []
      if (models.length) this.modelLists.set(id, models)
      return { models }
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : undefined
      return { models: [{ id: DEFAULT_MODELS[id].main }, { id: DEFAULT_MODELS[id].fast }], error: (e as Error).message, ...(status === 401 || status === 403 ? { rejected: true } : {}) }
    }
  }

  /** On first call with no explicit choice: prefer a provider that has a key. */
  async init(): Promise<void> {
    const prefs = await loadPrefs(this.d.home) // provider, model and effort come back as last left
    if (PROVIDER_IDS.includes(prefs.provider as ProviderId)) this.provider = prefs.provider as ProviderId
    if (prefs.model?.trim()) this.model = prefs.model
    if (EFFORT_LEVELS.includes(prefs.effort as Effort)) this.effort = prefs.effort as Effort
    if (prefs.notifications === false) this.notifications = false
    if (typeof prefs.systemPrompt === 'string') this.systemPrompt = prefs.systemPrompt
    this.systemReplace = prefs.systemReplace === true
    const s = await this.getSettings()
    const id = s.hasKey[this.provider] ? this.provider : (PROVIDER_IDS.find((p) => s.hasKey[p]) ?? this.provider)
    this.setProvider(id)
  }

  private setProvider(id: ProviderId): void {
    if (id !== this.provider) this.model = DEFAULT_MODELS[id].main
    this.provider = id
  }

  async setKey(id: ProviderId, key: string): Promise<SettingsInfo> {
    if (!PROVIDER_IDS.includes(id) || !key.trim()) throw new Error('Enter an API key.')
    await this.keys.set(id, key.trim())
    if (this.cache?.id === id) this.cache = undefined
    this.modelLists.delete(id) // the new key may see a different list
    return this.getSettings()
  }

  async update(patch: { provider?: ProviderId; model?: string; effort?: Effort; notifications?: boolean; systemPrompt?: string; systemReplace?: boolean }): Promise<SettingsInfo> {
    if (patch.provider || patch.model || patch.effort) this.assertIdle('change the model or effort') // notifications can change any time
    if (patch.notifications !== undefined) this.notifications = patch.notifications
    if (patch.systemPrompt !== undefined || patch.systemReplace !== undefined) {
      if (patch.systemPrompt !== undefined) this.systemPrompt = patch.systemPrompt.slice(0, MAX_SYSTEM_PROMPT)
      if (patch.systemReplace !== undefined) this.systemReplace = patch.systemReplace
      this.session?.setSystem(this.system()) // next turn; a running turn keeps the prompt it started with
    }
    if (patch.provider) {
      if (!PROVIDER_IDS.includes(patch.provider)) throw new Error(`Unknown provider "${patch.provider}".`)
      this.setProvider(patch.provider)
    }
    if (patch.model?.trim()) this.model = patch.model.trim()
    if (patch.effort) {
      if (!EFFORT_LEVELS.includes(patch.effort)) throw new Error(`Unknown effort "${patch.effort}".`)
      this.effort = patch.effort
    }
    await savePrefs({ provider: this.provider, model: this.model, effort: this.effort, notifications: this.notifications, systemPrompt: this.systemPrompt, systemReplace: this.systemReplace }, this.d.home).catch((e: Error) => this.notice('warn', e.message))
    return this.getSettings()
  }

  /** Built-in prompt, plus the user's instructions, or only those when "replace" is on and they are not empty. */
  private system(): string {
    const custom = this.systemPrompt.trim()
    if (!custom) return DEFAULT_SYSTEM_PROMPT
    return this.systemReplace ? custom : `${DEFAULT_SYSTEM_PROMPT}\n\n${custom}`
  }

  /** Same shape as the CLI's provider, but resolved lazily from the credential store so a key saved mid-session just works. */
  private proxy: ModelProvider
  private async current(): Promise<ModelProvider> {
    if (this.cache?.id === this.provider) return this.cache.p
    const key = await this.keys.get(this.provider)
    if (!key) throw new Error(`No API key for ${this.provider}. Add one in Settings.`)
    const p = (this.d.makeProvider ?? createProvider)(this.provider, key)
    this.cache = { id: this.provider, p }
    return p
  }
  private async *stream(req: Parameters<ModelProvider['stream']>[0]) {
    const model = req.model === FAST_MODEL ? DEFAULT_MODELS[this.provider].fast : this.model
    yield* (await this.current()).stream({ ...req, model, effort: this.effort })
  }

  private frontend: Frontend = {
    emit: (e) => {
      this.apply(e)
      if (e.type === 'attention') this.notify(e.message)
      if (e.type === 'turn_end') {
        this.stopTimer('long')
        if (e.reason === 'done') this.notify('MCA finished the task.')
        else if (e.reason === 'error') this.notify('MCA stopped because of an error.')
      }
      if (this.perms && this.perms.mode !== this.view.mode) this.announce() // ExitPlanMode changed the mode
    },
    ask: (request) =>
      new Promise<Decision>((resolve) => {
        const id = randomUUID()
        this.resolvePending = resolve
        this.pending = { id, request }
        this.startTimer('prompt', this.d.timings?.promptMs ?? 60_000, 'MCA is waiting for your approval.')
        this.d.prompt(this.pending)
      })
  }

  private notify(message: string): void {
    if (this.notifications) this.d.notify?.(message)
  }

  private timers: Partial<Record<'prompt' | 'long', ReturnType<typeof setTimeout>>> = {}
  private startTimer(k: 'prompt' | 'long', ms: number, message: string): void {
    this.stopTimer(k)
    if (this.d.notify) this.timers[k] = setTimeout(() => this.notify(message), ms)
  }
  private stopTimer(k: 'prompt' | 'long'): void {
    clearTimeout(this.timers[k])
    delete this.timers[k]
  }

  private clearPending(): void {
    this.stopTimer('prompt')
    const r = this.resolvePending
    this.pending = null
    this.resolvePending = undefined
    r?.({ allow: false, feedback: 'Aborted' })
  }

  answer(id: string, d: Decision): void {
    if (this.pending?.id !== id) throw new Error('No matching prompt is waiting for an answer.')
    this.stopTimer('prompt')
    const r = this.resolvePending
    this.pending = null
    this.resolvePending = undefined
    r?.(d)
  }

  private assertIdle(what: string): void {
    if (this.session?.busy || this.pending) throw new Error(`Cannot ${what} while a turn is running.`)
  }

  /** Opens a workspace: loads its settings, asks about trust (same flow as the CLI), and starts a fresh session. */
  async selectWorkspace(dir: string): Promise<void> {
    this.assertIdle('switch workspace')
    const make = (trusted: boolean) => createPermissions({ cwd: dir, mode: this.perms?.mode, trusted, canAsk: true, home: this.d.home })
    let built = await make(await isTrusted(dir, this.d.home))
    if (built.ignoredAllow.length || built.ignoredHooks.length || built.ignoredMcp.length) {
      if ((await this.frontend.ask({ kind: 'trust', workspace: dir, rules: built.ignoredAllow, hooks: built.ignoredHooks, mcp: built.ignoredMcp })).allow) {
        try {
          await trustWorkspace(dir, this.d.home)
          built = await make(true)
        } catch (e) {
          this.notice('warn', (e as Error).message)
        }
      }
      this.pending = null // a trust prompt is answered here, not by a turn
    }
    this.perms = built.perms
    this.workspace = dir
    await this.startMcp(built.mcp, dir)
    this.session = new AgentSession({ provider: this.proxy, model: '', system: this.system(), tools: this.tools(), cwd: dir, frontend: this.frontend, decide: built.perms.decide, plan: built.perms, fastModel: FAST_MODEL, hooks: built.hooks, reminder: () => buildReminder(dir, { home: this.d.home }) })
    this.session.store = new Transcript(dir, this.meta, { home: this.d.home })
    await rememberWorkspace(dir, this.d.home).catch((e: Error) => this.notice('warn', e.message))
    this.apply({ type: 'clear' })
    this.announce()
    const [latest] = this.chats()
    if (latest) this.openChat(latest.id) // a workspace switch continues where that workspace left off
    for (const w of built.warnings) this.notice('warn', w)
  }

  private mcp?: McpManager
  private tools = () => [...builtinTools, ...(this.mcp?.tools ?? [])]

  /** (Re)starts the workspace's MCP servers; the previous ones are stopped first. A failing server is reported and skipped. */
  private async startMcp(config: Parameters<typeof McpManager.start>[0], dir: string): Promise<void> {
    await this.mcp?.close()
    this.mcp = await McpManager.start(config, { cwd: dir })
    for (const s of this.mcp.status) if (s.state !== 'connected') this.notice('warn', `MCP server "${s.name}": ${s.message}`)
  }

  private meta = () => ({ provider: this.provider, model: this.model })

  /** Launch: reopen the last workspace (the trust prompt still applies). */
  async openLast(): Promise<void> {
    const [dir] = await recentWorkspaces(this.d.home)
    if (dir) await this.selectWorkspace(dir)
  }

  recent(): Promise<string[]> {
    return recentWorkspaces(this.d.home)
  }

  /** The renderer never supplies a path of its own: only one already in the recent list opens. */
  async openRecent(dir: string): Promise<void> {
    if (!(await this.recent()).includes(dir)) throw new Error('Unknown workspace. Open it with the folder picker.')
    await this.selectWorkspace(dir)
  }

  /** Drops a workspace from the recent list. The open workspace stays; files and saved chats are untouched. */
  async forgetRecent(dir: string): Promise<void> {
    if (!(await this.recent()).includes(dir)) throw new Error('Unknown workspace.')
    if (dir === this.workspace) throw new Error('Open another workspace first; this one is in use.')
    await forgetWorkspace(dir, this.d.home)
  }

  chats(): SessionInfo[] {
    return this.workspace ? listSessions(this.workspace, this.d.home) : []
  }

  /** Deletes a saved chat. The open chat is replaced by a fresh one; a running turn blocks it. */
  deleteChat(id: string): void {
    this.assertIdle('delete a chat')
    if (!this.workspace) throw new Error('Open a workspace first.')
    if (!this.chats().some((c) => c.id === id)) throw new Error('Unknown chat.')
    const current = this.session?.store?.id === id
    deleteSession(this.workspace, id, this.d.home)
    if (current) this.newChat()
  }

  /** Markdown copy of a saved chat; the caller decides where it is written. */
  exportChat(id: string): { title: string; markdown: string } {
    if (!this.workspace) throw new Error('Open a workspace first.')
    if (!this.chats().some((c) => c.id === id)) throw new Error('Unknown chat.')
    const { meta, messages } = parseTranscript(readFileSync(join(sessionDir(this.workspace, this.d.home), `${id}.jsonl`), 'utf8'))
    const title = meta.title || 'Chat'
    return { title, markdown: exportMarkdown(title, messages) }
  }

  newChat(): void {
    this.assertIdle('start a new chat')
    if (!this.session) throw new Error('Open a workspace first.')
    this.session.clear() // moves to a fresh transcript file
    this.apply({ type: 'clear' })
  }

  /** Loads a saved chat of this workspace, rebuilds the view from its messages and keeps appending to its file. */
  openChat(id: string): void {
    this.assertIdle('open a chat')
    if (!this.session || !this.workspace) throw new Error('Open a workspace first.')
    if (!this.chats().some((c) => c.id === id)) throw new Error('Unknown chat.')
    const { transcript, messages } = loadSession(this.workspace, id, this.meta, this.d.home)
    this.session.load(messages, transcript)
    this.apply({ type: 'clear' })
    for (const e of messagesToEvents(messages)) this.apply(e)
    void this.refreshChanges()
  }

  private announce(): void {
    this.apply({ type: 'session', workspace: this.workspace, mode: this.perms?.mode ?? 'default', mcp: describeStatus(this.mcp?.status ?? []) })
  }

  /** Starts a turn and returns at once; progress arrives as events. */
  send(text: string, files: Attachment[] = []): void {
    const s = this.session
    if (!s || !this.workspace) throw new Error('Open a workspace first.')
    if (s.busy) throw new Error('A turn is already running.')
    const blocks: Block[] = files.map((f) => {
      if (IMAGE_MIMES.includes(f.mime)) return { type: 'image', mime: f.mime, data: f.data }
      const body = Buffer.from(f.data, 'base64').toString('utf8')
      if (body.includes('\0')) throw new Error(`${f.name} looks like a binary file; only text files and images can be attached.`)
      return { type: 'text', text: `<attached_file name=${JSON.stringify(f.name)}>\n${body}\n</attached_file>` }
    })
    this.apply({ type: 'user_message', text, ...(files.length && { attachments: files.map((f) => f.name) }) })
    this.startTimer('long', this.d.timings?.longTurnMs ?? 10 * 60_000, 'MCA is still working on your request.')
    void s.send(text, blocks).catch((e: Error) => (this.stopTimer('long'), this.notice('error', e.message)))
  }

  abort(): void {
    this.session?.abort()
    this.clearPending() // a prompt still on screen is a denial; the turn then unwinds
  }

  /** Slash commands the renderer may run. /exit is CLI-only; /trust goes through the trust prompt below. */
  static readonly COMMANDS = ['help', 'clear', 'compact', 'mode', 'model', 'provider', 'rewind', 'diff', 'trust', 'resume', 'mcp']

  async command(line: string): Promise<void> {
    const s = this.session
    const p = parseInput(line, this.workspace ? await loadCommands(this.workspace, { home: this.d.home }) : [])
    if (p.kind === 'prompt') return this.send(p.text)
    if (p.kind === 'unknown' || !Controller.COMMANDS.includes(p.name)) return this.notice('error', `Unknown command /${p.name}.`)
    if (!s || !this.perms || !this.workspace) return this.notice('error', 'Open a workspace first.')
    if (p.name === 'trust') return this.trust()
    const out: string[] = []
    const before = s.history.length
    await runCommand(p.name, p.args, { session: s, perms: this.perms, workspace: this.workspace, print: (m) => void out.push(m), exit: () => {}, trustWorkspace: async () => {}, resume: (a) => this.resume(a), mcpStatus: () => this.view.mcp, models: this.modelEnv() })
    if (p.name === 'rewind' && s.history.length < before) this.apply({ type: 'rewind' })
    if (p.name === 'clear' && !s.busy) this.apply({ type: 'clear' })
    if (p.name === 'rewind') await this.refreshChanges() // the previous turn's changes are now the newest
    this.announce() // mode may have changed
    for (const m of out) this.notice('info', m)
  }

  /** `/resume`: no argument lists this workspace's chats (newest first); a number or id opens one. */
  private async resume(arg: string): Promise<string> {
    const chats = this.chats()
    if (!arg) {
      if (!chats.length) return 'No saved chats in this workspace yet.'
      return ['Saved chats (newest first):', ...chats.slice(0, 20).map((c, i) => `  ${i + 1}. ${c.title} (${c.messageCount} messages)`), 'Open one with /resume <number>.'].join('\n')
    }
    const chat = /^\d+$/.test(arg) ? chats[Number(arg) - 1] : chats.find((c) => c.id === arg)
    if (!chat) return `No chat matches "${arg.slice(0, 40)}". Run /resume to list them.`
    this.openChat(chat.id)
    return `Opened "${chat.title}".`
  }

  private modelEnv() {
    return {
      current: () => ({ provider: this.provider as string, model: this.model }),
      providers: PROVIDER_IDS as readonly string[],
      setModel: async (model: string) => void (await this.update({ model })),
      setProvider: async (id: string) => (await this.update({ provider: id as ProviderId }), this.model)
    }
  }

  private async changeSet(scope: 'turn' | 'all'): Promise<{ root: string; images: Map<string, Buffer | null> }> {
    if (!this.session || !this.workspace) throw new Error('Open a workspace first.')
    await this.session.files.ready()
    return { root: this.workspace, images: this.session.files.beforeImages(scope) }
  }

  /** Recomputes the changed-file summaries from disk and tells the renderer. */
  private async refreshChanges(): Promise<void> {
    try {
      const turn = await this.changeSet('turn')
      const total = await this.changeSet('all')
      this.apply({ type: 'changes', turn: await summarizeChanges(turn.images, turn.root), total: await summarizeChanges(total.images, total.root) })
    } catch (e) {
      this.notice('warn', `Could not list changed files: ${(e as Error).message}`)
    }
  }

  /** The diff of one changed file. `path` must be one of the listed changes; anything else is refused. */
  async changeDiff(scope: 'turn' | 'all', path: string): Promise<string> {
    const { root, images } = await this.changeSet(scope)
    const diff = await diffFor(images, root, resolve(root, path))
    if (diff === undefined) throw new Error('Unknown changed file.')
    return diff
  }

  /** Restores one changed file to its state before the agent touched it, then refreshes the list. */
  async changeRevert(scope: 'turn' | 'all', path: string): Promise<void> {
    this.assertIdle('revert a file')
    const { root } = await this.changeSet(scope)
    if (!(await this.session!.files.revertFile(resolve(root, path), scope))) throw new Error('Unknown changed file.')
    await this.refreshChanges()
  }

  /** What slash autocomplete offers: the commands the window may run plus the workspace's custom ones. */
  async commandList(): Promise<CommandInfo[]> {
    const builtin = Controller.COMMANDS.map((name) => ({ name, description: BUILTIN_INFO[name as keyof typeof BUILTIN_INFO], custom: false }))
    const custom = this.workspace ? await loadCommands(this.workspace, { home: this.d.home }) : []
    return [...builtin, ...custom.map((c) => ({ name: c.name, description: c.description, custom: true }))]
  }

  /** Never trusts silently: the user answers the same TrustRequest prompt as on workspace open. */
  private async trust(): Promise<void> {
    const dir = this.workspace!
    this.assertIdle('change trust')
    const fresh = await createPermissions({ cwd: dir, trusted: false, canAsk: true, home: this.d.home })
    if (!(await this.frontend.ask({ kind: 'trust', workspace: dir, rules: fresh.ignoredAllow, hooks: fresh.ignoredHooks, mcp: fresh.ignoredMcp })).allow) return this.notice('info', 'Workspace not trusted.')
    try {
      await trustWorkspace(dir, this.d.home)
    } catch (e) {
      return this.notice('warn', (e as Error).message)
    }
    const trusted = await createPermissions({ cwd: dir, trusted: true, canAsk: true, home: this.d.home })
    for (const r of trusted.perms.rules.allow) if (!this.perms!.rules.allow.includes(r)) this.perms!.rules.allow.push(r)
    this.session?.setHooks(trusted.hooks)
    await this.startMcp(trusted.mcp, dir)
    this.session?.setTools(this.tools())
    this.announce()
    this.notice('info', `Trusted ${dir}. Its project allow rules, hooks and MCP servers are now active.`)
  }

  /** Window closed or app quitting: abort the turn (denies pending asks, kills children). */
  dispose(): void {
    this.abort()
    void this.mcp?.close()
  }
}
