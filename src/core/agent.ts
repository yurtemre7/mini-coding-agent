import type { AgentEvent, Decision, Effort, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import { FileState } from './filestate'
import type { Block, Message, ModelProvider } from './provider/types'
import type { Transcript } from './session'
import { isZod, toToolDef, truncate, type Tool, type ToolContext } from './tool'

export interface Frontend {
  emit(event: AgentEvent): void
  ask(request: PermissionRequest | PlanRequest | TrustRequest): Promise<Decision>
}

export interface TurnOptions {
  provider: ModelProvider
  model: string
  system: string
  tools: Tool[]
  cwd: string
  frontend: Frontend
  signal: AbortSignal
  maxTokens?: number
  /** Extra blocks (images, inlined files) sent with the user's text. */
  attachments?: Block[]
  effort?: Effort // passed on every stream call; subagents inherit it
  /** Called once per complete message, in history order (the transcript file). */
  persist?: (m: Message) => void
  files?: FileState // readState + checkpoints + Bash cwd; AgentSession keeps one across turns
  maxIterations?: number // 50 per turn (25 for subagents)
  /** Permission seam (filled in Milestone 3). Return a denial reason to block the call; undefined allows it. */
  decide?: (tool: Tool, input: unknown, ctx: ToolContext) => Promise<string | undefined>
}

type ToolCall = Extract<Block, { type: 'tool_use' }>
type ToolResult = Extract<Block, { type: 'tool_result' }>
export type TurnReason = Extract<AgentEvent, { type: 'turn_end' }>['reason']

const INTERRUPTED = 'Interrupted before this tool ran.'
const CONCURRENCY = 8

/** Drops empty assistant messages and answers every unanswered tool_use, so the next request is accepted. */
export function sealHistory(history: Message[]): void {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'assistant' && history[i].content.length === 0) history.splice(i, 1)
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    if (m.role !== 'assistant') continue
    const next = history[i + 1]
    const answered = new Set(next?.role === 'user' ? next.content.flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : [])) : [])
    const missing: Block[] = m.content.flatMap((b) =>
      b.type === 'tool_use' && !answered.has(b.id) ? [{ type: 'tool_result' as const, tool_use_id: b.id, content: INTERRUPTED, is_error: true }] : []
    )
    if (!missing.length) continue
    if (next?.role === 'user') next.content.unshift(...missing) // tool_results must come first
    else history.splice(i + 1, 0, { role: 'user', content: missing })
  }
}

const describeIssues = (e: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  e.issues.map((i) => `${i.path.map(String).join('.') || '(input)'}: ${i.message}`).join('; ')

export async function runOne(call: ToolCall, opts: TurnOptions): Promise<ToolResult> {
  const { frontend: fe } = opts
  fe.emit({ type: 'tool_start', id: call.id, name: call.name, input: call.input })
  let content: string
  let isError = false
  try {
    if (opts.signal.aborted) throw new Error(INTERRUPTED)
    const tool = opts.tools.find((t) => t.name === call.name)
    if (!tool) throw new Error(`Unknown tool "${call.name}". Available tools: ${opts.tools.map((t) => t.name).join(', ')}.`)
    let input = call.input
    if (isZod(tool.schema)) {
      const parsed = tool.schema.safeParse(call.input)
      if (!parsed.success) throw new Error(`Invalid input for ${tool.name}: ${describeIssues(parsed.error)}`)
      input = parsed.data
    } // shortcut: raw JSON-Schema (MCP) tools are validated by their server
    const files = (opts.files ??= new FileState())
    const ctx: ToolContext = {
      cwd: files.cwd ?? opts.cwd,
      root: opts.cwd,
      files,
      setCwd: (dir) => void (files.cwd = dir),
      signal: opts.signal,
      // a pending ask() resolves as a denial the moment the turn is aborted
      ask: (req) => {
        const denied: Decision = { allow: false, feedback: 'Aborted' }
        if (opts.signal.aborted) return Promise.resolve(denied)
        let onAbort!: () => void
        const aborted = new Promise<Decision>((res) => opts.signal.addEventListener('abort', (onAbort = () => res(denied)), { once: true }))
        return Promise.race([fe.ask(req), aborted]).finally(() => opts.signal.removeEventListener('abort', onAbort))
      }
    }
    const denied = await opts.decide?.(tool, input, ctx)
    if (denied !== undefined) throw new Error(`Permission denied: ${denied}`)
    content = await tool.run(input, ctx)
  } catch (e) {
    isError = true
    content = e instanceof Error ? e.message : String(e)
  }
  content = truncate(content.trim() === '' ? '(no output)' : content)
  fe.emit({ type: 'tool_end', id: call.id, result: content, isError })
  return { type: 'tool_result', tool_use_id: call.id, content, ...(isError && { is_error: true }) }
}

function isReadOnly(call: ToolCall, tools: Tool[]): boolean {
  const t = tools.find((x) => x.name === call.name)
  if (!t) return false
  try {
    return typeof t.readOnly === 'function' ? t.readOnly(call.input) : t.readOnly
  } catch {
    return false
  }
}

/** Consecutive read-only calls run in parallel (max 8); anything else runs alone. Results keep call order. */
export async function runTools(calls: ToolCall[], opts: TurnOptions): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (let i = 0; i < calls.length; ) {
    let j = i + 1
    if (isReadOnly(calls[i], opts.tools)) while (j < calls.length && isReadOnly(calls[j], opts.tools)) j++
    const batch = calls.slice(i, j)
    const out = new Array<ToolResult>(batch.length)
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (next < batch.length) {
          const k = next++
          out[k] = await runOne(batch[k], opts)
        }
      })
    )
    results.push(...out)
    i = j
  }
  return results
}

export async function runTurn(history: Message[], userText: string, opts: TurnOptions): Promise<TurnReason> {
  const { provider, frontend: fe, signal } = opts
  const maxIterations = opts.maxIterations ?? 50
  const toolDefs = opts.tools.map(toToolDef)
  let reason: TurnReason = 'done'
  fe.emit({ type: 'turn_start' })
  history.push({ role: 'user', content: [{ type: 'text', text: userText }, ...(opts.attachments ?? [])] })
  let saved = history.length - 1
  const save = () => {
    for (; saved < history.length; saved++) if (history[saved].content.length) opts.persist?.(history[saved])
  }
  save()
  ;(opts.files ??= new FileState()).beginTurn()
  try {
    const contextWindow = await provider.contextWindow(opts.model)
    let iteration = 0
    for (; ; iteration++) {
      if (signal.aborted) return (reason = 'aborted')
      if (iteration >= maxIterations) {
        fe.emit({ type: 'notice', level: 'warn', message: `Stopped after ${maxIterations} model calls in one turn. Send another message to continue.` })
        return (reason = 'max_iterations')
      }
      const content: Block[] = []
      history.push({ role: 'assistant', content }) // filled while streaming so aborted text is kept
      let stop = 'end_turn'
      for await (const ev of provider.stream({ model: opts.model, system: opts.system, messages: history.slice(0, -1), tools: toolDefs, maxTokens: opts.maxTokens ?? 8192, effort: opts.effort, signal })) {
        if (ev.type === 'text_delta') {
          const last = content.at(-1)
          if (last?.type === 'text') last.text += ev.text
          else content.push({ type: 'text', text: ev.text })
          fe.emit({ type: 'text_delta', text: ev.text })
        } else if (ev.type === 'tool_use') content.push(ev)
        else if (ev.type === 'usage') fe.emit({ type: 'usage', contextTokens: ev.contextTokens, contextWindow })
        else stop = ev.reason
      }
      if (signal.aborted) return (reason = 'aborted')
      if (stop === 'error') {
        fe.emit({ type: 'notice', level: 'error', message: 'The model stopped with an error.' })
        return (reason = 'error')
      }
      if (stop === 'max_tokens') {
        // a truncated tool_use is never executed. ALL tool_use blocks go: OpenRouter also emits the cut call (with raw args), so it cannot be told apart
        const kept = content.filter((b) => b.type !== 'tool_use')
        content.splice(0, content.length, ...kept)
        if (!kept.length) history.pop() // never send an empty assistant message
        history.push({ role: 'user', content: [{ type: 'text', text: 'Your response was cut off by the output limit. Continue, working in smaller steps (smaller edits, shorter output).' }] })
        save()
        continue
      }
      const calls = content.filter((b): b is ToolCall => b.type === 'tool_use')
      save() // the finished assistant message; a crash during the tools leaves a dangling tool_use that loading repairs
      if (!calls.length) return reason
      history.push({ role: 'user', content: await runTools(calls, opts) })
      save()
    }
  } catch (e) {
    if (signal.aborted) reason = 'aborted'
    else {
      reason = 'error'
      fe.emit({ type: 'notice', level: 'error', message: e instanceof Error ? e.message : String(e) })
    }
    return reason
  } finally {
    sealHistory(history)
    save()
    fe.emit({ type: 'turn_end', reason })
  }
}

/** One turn at a time: a second send() while a turn runs is rejected. */
export class AgentSession {
  history: Message[] = []
  private starts: number[] = [] // history index where each turn began; parallels the FileState checkpoint stack
  private controller?: AbortController
  /** Where messages are saved; set by the frontend. clear() moves to a new file. */
  store?: Transcript
  private saveFailed = false
  constructor(private base: Omit<TurnOptions, 'signal'>) {
    this.base = { ...base, files: base.files ?? new FileState() }
  }

  get busy(): boolean {
    return !!this.controller
  }

  get files(): FileState {
    return this.base.files!
  }

  /** Undoes the newest turn: restores its files, then drops it from history. Returns restored paths, or undefined when there is nothing to undo. */
  async rewind(): Promise<string[] | undefined> {
    if (this.controller) throw new Error('A turn is running. Abort it before rewinding.')
    const restored = await this.files.rewind() // first: if it throws, history is untouched and the rewind can be retried
    if (!restored) return undefined
    this.history.length = this.starts.pop() ?? 0
    this.persist(() => this.store?.rewind(this.history.length))
    return restored
  }

  clear(): void {
    if (this.controller) throw new Error('A turn is running. Abort it before clearing.')
    this.history.length = 0
    this.starts.length = 0
    this.base.files = new FileState()
    this.store = this.store?.fresh()
  }

  /** Continues a saved conversation: replaces the history (rewind checkpoints of earlier runs are gone). */
  load(messages: Message[], store: Transcript): void {
    if (this.controller) throw new Error('A turn is running. Abort it before opening another chat.')
    this.history.splice(0, this.history.length, ...messages)
    this.starts.length = 0
    this.base.files = new FileState()
    this.store = store
  }

  /** A failing disk must not break the turn; say so once. */
  private persist(write: () => void): void {
    try {
      write()
    } catch (e) {
      if (!this.saveFailed) this.base.frontend.emit({ type: 'notice', level: 'warn', message: `Could not save this chat: ${(e as Error).message}` })
      this.saveFailed = true
    }
  }

  async send(text: string, attachments?: Block[]): Promise<TurnReason> {
    if (this.controller) throw new Error('A turn is already running. Wait for it to finish or abort it.')
    this.controller = new AbortController()
    const store = this.store
    this.starts.push(this.history.length)
    try {
      return await runTurn(this.history, text, { ...this.base, attachments, persist: (m) => this.persist(() => store?.append(m)), signal: this.controller.signal })
    } finally {
      this.controller = undefined
    }
  }

  abort(): void {
    this.controller?.abort()
  }
}
