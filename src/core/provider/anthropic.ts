import Anthropic from '@anthropic-ai/sdk'
import { anthropicContextWindow } from './models'
import { authMessage, ProviderError, withRetry } from './retry'
import type { Message, ModelInfo, ModelProvider, StopReason, StreamEvent, StreamRequest } from './types'

// The slice of the SDK we use, so tests can inject a fake.
export interface AnthropicLike {
  messages: { create(body: any, opts: { signal: AbortSignal }): Promise<AsyncIterable<any>> }
  models: { list(): AsyncIterable<{ id: string }> }
}

const parseJson = (s: string): unknown => {
  if (s === '') return {}
  try {
    return JSON.parse(s)
  } catch {
    return s // validation fails normally and the model is told why
  }
}

function toProviderError(e: any): Error {
  const status: number | undefined = e?.status
  if (e instanceof ProviderError) return e
  // the SDK throws an APIError with no status for in-stream error events
  const inStream = e?.error?.error?.type ?? e?.error?.type
  if (status === undefined) return inStream === 'overloaded_error' ? new ProviderError(e.message, 529) : e
  if (status === 401 || status === 403) return new ProviderError(authMessage('Anthropic', 'ANTHROPIC_API_KEY'), status)
  const ra = Number(e.headers?.get?.('retry-after'))
  return new ProviderError(e.message, status, ra > 0 ? ra * 1000 : undefined)
}

// Cache breakpoints: system prompt + last block of the last message.
function withCache(messages: Message[]): Message[] {
  const last = messages.at(-1)
  if (!last?.content.length) return messages
  const content: any[] = last.content.map((b, i) =>
    i === last.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b
  )
  return [...messages.slice(0, -1), { ...last, content }]
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const
  private client: AnthropicLike

  constructor(
    apiKey: string,
    private opts: { client?: AnthropicLike; sleep?: (ms: number, s: AbortSignal) => Promise<void> } = {}
  ) {
    // maxRetries: 0 because withRetry owns the policy
    this.client = opts.client ?? new Anthropic({ apiKey, maxRetries: 0 })
  }

  async contextWindow(model: string): Promise<number> {
    return anthropicContextWindow(model)
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const ids: ModelInfo[] = []
      for await (const m of this.client.models.list()) ids.push({ id: m.id }) // the SDK pages automatically
      return ids
    } catch (e) {
      throw toProviderError(e)
    }
  }

  private noEffort = new Set<string>() // models that rejected output_config.effort

  async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
    const effort = this.noEffort.has(req.model) ? undefined : req.effort
    try {
      yield* withRetry(() => this.once({ ...req, effort }), req.signal, this.opts.sleep)
    } catch (e) {
      // a model without effort support answers 400 before any event; resend once without it
      if (!effort || !(e instanceof ProviderError) || e.status !== 400 || !/effort/i.test(e.message)) throw e
      this.noEffort.add(req.model)
      yield* withRetry(() => this.once({ ...req, effort: undefined }), req.signal, this.opts.sleep)
    }
  }

  private async *once(req: StreamRequest): AsyncGenerator<StreamEvent> {
    let events: AsyncIterable<any>
    try {
      events = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: withCache(req.messages),
          tools: req.tools,
          ...(req.effort && { output_config: { effort: req.effort } }),
          stream: true
        },
        { signal: req.signal }
      )
      let contextTokens = 0
      let stop: StopReason = 'end_turn'
      // one open content block at a time
      let tool: { id: string; name: string; json: string } | undefined
      for await (const ev of events) {
        if (ev.type === 'message_start') {
          const u = ev.message.usage ?? {}
          contextTokens =
            (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
          tool = { id: ev.content_block.id, name: ev.content_block.name, json: '' }
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta') yield { type: 'text_delta', text: ev.delta.text }
          else if (ev.delta.type === 'input_json_delta' && tool) tool.json += ev.delta.partial_json
        } else if (ev.type === 'content_block_stop' && tool) {
          yield { type: 'tool_use', id: tool.id, name: tool.name, input: parseJson(tool.json) }
          tool = undefined
        } else if (ev.type === 'message_delta') {
          if (ev.delta.stop_reason === 'tool_use' || ev.delta.stop_reason === 'max_tokens') stop = ev.delta.stop_reason
          yield { type: 'usage', contextTokens, outputTokens: ev.usage?.output_tokens ?? 0 }
        } else if (ev.type === 'error') {
          throw new ProviderError(ev.error?.message ?? 'stream error', ev.error?.type === 'overloaded_error' ? 529 : 500)
        }
      }
      yield { type: 'stop', reason: stop }
    } catch (e) {
      throw toProviderError(e)
    }
  }
}
