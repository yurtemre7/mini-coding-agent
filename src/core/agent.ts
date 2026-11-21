import type { AgentEvent, Decision, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import type { Block, Message, ModelProvider } from './provider/types'
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
    const ctx: ToolContext = {
      cwd: opts.cwd,
      signal: opts.signal,
      // a pending ask() resolves as a denial the moment the turn is aborted
      ask: (req) =>
        Promise.race([
          fe.ask(req),
          new Promise<Decision>((res) => opts.signal.addEventListener('abort', () => res({ allow: false, feedback: 'Aborted' }), { once: true }))
        ])
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
  history.push({ role: 'user', content: [{ type: 'text', text: userText }] })
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
      for await (const ev of provider.stream({ model: opts.model, system: opts.system, messages: history.slice(0, -1), tools: toolDefs, maxTokens: opts.maxTokens ?? 8192, signal })) {
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
        // a truncated tool_use is never executed
        const kept = content.filter((b) => b.type !== 'tool_use')
        content.splice(0, content.length, ...kept)
        if (!kept.length) history.pop() // never send an empty assistant message
        history.push({ role: 'user', content: [{ type: 'text', text: 'Your response was cut off by the output limit. Continue, working in smaller steps (smaller edits, shorter output).' }] })
        continue
      }
      const calls = content.filter((b): b is ToolCall => b.type === 'tool_use')
      if (!calls.length) return reason
      history.push({ role: 'user', content: await runTools(calls, opts) })
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
    fe.emit({ type: 'turn_end', reason })
  }
}

/** One turn at a time: a second send() while a turn runs is rejected. */
export class AgentSession {
  history: Message[] = []
  private controller?: AbortController
  constructor(private base: Omit<TurnOptions, 'signal'>) {}

  get busy(): boolean {
    return !!this.controller
  }

  async send(text: string): Promise<TurnReason> {
    if (this.controller) throw new Error('A turn is already running. Wait for it to finish or abort it.')
    this.controller = new AbortController()
    try {
      return await runTurn(this.history, text, { ...this.base, signal: this.controller.signal })
    } finally {
      this.controller = undefined
    }
  }

  abort(): void {
    this.controller?.abort()
  }
}
