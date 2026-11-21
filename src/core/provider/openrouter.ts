import { OPENROUTER_DEFAULT_CONTEXT_WINDOW } from './models'
import { authMessage, ProviderError, withRetry } from './retry'
import type { Message, ModelInfo, ModelProvider, StopReason, StreamEvent, StreamRequest } from './types'

const BASE = 'https://openrouter.ai/api/v1'

/** OpenRouter marks a zero-cost model with a `:free` suffix on its id (e.g. `baidu/ernie-5.5-flash-preview:free`). */
export const isFreeModel = (id: string): boolean => /:free$/.test(id)

/** Canonical messages -> OpenAI chat format. */
export function toOpenAI(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      const calls = m.content.flatMap((b) =>
        b.type === 'tool_use'
          ? [{ id: b.id, type: 'function', function: { name: b.name, arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input) } }]
          : []
      )
      out.push({ role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls }) })
    } else {
      // tool results first, each its own message, immediately after the assistant message
      for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${b.content}` : b.content })
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      if (text) out.push({ role: 'user', content: text })
    }
  }
  return out
}

/** Splits a byte/string stream into SSE `data:` payloads; ignores comments, handles split lines. */
export async function* sseData(chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const dec = new TextDecoder()
  let buf = ''
  const lines = function* (final: boolean) {
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
    }
    if (final && buf) yield buf
  }
  for await (const c of chunks) {
    buf += typeof c === 'string' ? c : dec.decode(c, { stream: true })
    for (const line of lines(false)) if (line.startsWith('data:')) yield line.slice(5).trim()
  }
  for (const line of lines(true)) if (line.startsWith('data:')) yield line.slice(5).trim()
}

const FINISH: Record<string, StopReason> = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', error: 'error' }

/** Parsed SSE payloads -> StreamEvents. `estimateIn` is the fallback when no usage is sent. */
export async function* openRouterEvents(data: AsyncIterable<string>, estimateIn = 0): AsyncGenerator<StreamEvent> {
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let finish: string | undefined
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  let chars = 0
  for await (const payload of data) {
    if (payload === '[DONE]') break
    let chunk: any
    try {
      chunk = JSON.parse(payload)
    } catch {
      continue
    }
    if (chunk.error) {
      const code = Number(chunk.error.code)
      throw new ProviderError(chunk.error.message ?? 'OpenRouter stream error', code >= 100 ? code : 500)
    }
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const d = choice.delta ?? {}
    if (d.content) {
      chars += d.content.length
      yield { type: 'text_delta', text: d.content }
    }
    for (const tc of d.tool_calls ?? []) {
      const cur = calls.get(tc.index ?? 0) ?? { id: '', name: '', args: '' }
      cur.id ||= tc.id ?? ''
      cur.name ||= tc.function?.name ?? ''
      cur.args += tc.function?.arguments ?? ''
      chars += (tc.function?.arguments ?? '').length
      calls.set(tc.index ?? 0, cur)
    }
    if (choice.finish_reason) finish = choice.finish_reason
  }
  for (const [i, c] of [...calls].sort((a, b) => a[0] - b[0])) {
    let input: unknown = {}
    if (c.args) {
      try {
        input = JSON.parse(c.args)
      } catch {
        input = c.args // validation fails normally and the model is told why
      }
    }
    yield { type: 'tool_use', id: c.id || `call_${i}`, name: c.name, input }
  }
  yield {
    type: 'usage',
    contextTokens: usage?.prompt_tokens ?? estimateIn,
    outputTokens: usage?.completion_tokens ?? Math.ceil(chars / 4)
  }
  const reason = FINISH[finish ?? 'stop'] ?? 'end_turn'
  yield { type: 'stop', reason: calls.size && reason === 'end_turn' ? 'tool_use' : reason }
}

export class OpenRouterProvider implements ModelProvider {
  readonly id = 'openrouter' as const
  private windows?: Promise<{ id: string; context_length: number }[]>

  constructor(
    private apiKey: string,
    private opts: { fetch?: typeof fetch; sleep?: (ms: number, s: AbortSignal) => Promise<void> } = {}
  ) {}

  private get doFetch(): typeof fetch {
    return this.opts.fetch ?? fetch
  }

  /** One /models fetch, cached: a failure is cached too (context windows fall back to the default; listModels reports it). */
  private catalog(): Promise<{ id: string; context_length: number }[]> {
    this.windows ??= this.doFetch(`${BASE}/models`, { headers: { authorization: `Bearer ${this.apiKey}` } }).then(async (r) => {
      if (r.status === 401 || r.status === 403) throw new ProviderError(authMessage('OpenRouter', 'OPENROUTER_API_KEY'), r.status)
      if (!r.ok) throw new ProviderError(`OpenRouter error ${r.status} listing models`, r.status)
      return ((await r.json()) as { data: { id: string; context_length: number }[] }).data
    })
    return this.windows
  }

  async contextWindow(model: string): Promise<number> {
    const m = await this.catalog().catch(() => [])
    return m.find((x) => x.id === model)?.context_length ?? OPENROUTER_DEFAULT_CONTEXT_WINDOW
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      return (await this.catalog())
        .map((m) => ({ id: m.id, ...(isFreeModel(m.id) && { free: true }) }))
        .sort((a, b) => a.id.localeCompare(b.id))
    } catch (e) {
      this.windows = undefined // let the next attempt retry
      throw e instanceof ProviderError ? e : new ProviderError(`Could not list OpenRouter models: ${(e as Error).message}`, 502)
    }
  }

  stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    return withRetry(() => this.once(req), req.signal, this.opts.sleep)
  }

  private async *once(req: StreamRequest): AsyncGenerator<StreamEvent> {
    const messages = toOpenAI(req.system, req.messages)
    const body = {
      model: req.model,
      messages,
      stream: true,
      max_tokens: req.maxTokens,
      usage: { include: true },
      ...(req.effort && { reasoning: { effort: req.effort === 'xhigh' || req.effort === 'max' ? 'high' : req.effort } }), // OpenRouter takes low|medium|high
      ...(req.tools.length && {
        tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
      })
    }
    const res = await this.doFetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new ProviderError(authMessage('OpenRouter', 'OPENROUTER_API_KEY'), res.status)
      const ra = Number(res.headers.get('retry-after'))
      throw new ProviderError(`OpenRouter error ${res.status}: ${(await res.text()).slice(0, 500)}`, res.status, ra > 0 ? ra * 1000 : undefined)
    }
    if (!res.body) throw new ProviderError('OpenRouter returned no body', 502)
    yield* openRouterEvents(sseData(res.body as unknown as AsyncIterable<Uint8Array>), Math.ceil(JSON.stringify(messages).length / 4))
  }
}
