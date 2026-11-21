import { describe, expect, it, vi } from 'vitest'
import { AnthropicProvider, type AnthropicLike } from './anthropic'
import { ProviderError } from './retry'
import type { StreamEvent, StreamRequest } from './types'

const req = (over: Partial<StreamRequest> = {}): StreamRequest => ({
  model: 'm', system: 'sys', maxTokens: 10, tools: [], signal: new AbortController().signal,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }],
  ...over
})
async function* gen(events: any[], failAfter?: Error) {
  for (const e of events) yield e
  if (failAfter) throw failAfter
}
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = []
  for await (const e of it) out.push(e)
  return out
}
const client = (...calls: (() => Promise<AsyncIterable<any>>)[]) => {
  const create = vi.fn(async () => calls.shift()!())
  return { create, client: { messages: { create } } as unknown as AnthropicLike }
}
const apiError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error('boom'), { status, headers: new Headers(headers) })
const sleep = vi.fn(async () => {})

const happy = [
  { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } },
  { type: 'content_block_start', content_block: { type: 'text' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
  { type: 'content_block_stop' },
  { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read' } },
  { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_' } },
  { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'path":"x"}' } },
  { type: 'content_block_stop' },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }
]

describe('AnthropicProvider.listModels', () => {
  it('collects ids and maps 401 to an error naming the env var', async () => {
    const ok = { messages: {}, models: { list: () => gen([{ id: 'a' }, { id: 'b' }]) } } as unknown as AnthropicLike
    expect(await new AnthropicProvider('k', { client: ok }).listModels()).toEqual([{ id: 'a' }, { id: 'b' }])
    const bad = { messages: {}, models: { list: () => gen([], apiError(401)) } } as unknown as AnthropicLike
    await expect(new AnthropicProvider('k', { client: bad }).listModels()).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })
})

describe('AnthropicProvider', () => {
  it('maps a stream: text, fragmented tool args, cached-token usage, stop', async () => {
    const { client: c } = client(async () => gen(happy))
    const events = await collect(new AnthropicProvider('k', { client: c }).stream(req()))
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x' } },
      { type: 'usage', contextTokens: 115, outputTokens: 7 },
      { type: 'stop', reason: 'tool_use' }
    ])
  })

  it('keeps unparseable tool args as the raw string; drops a tool_use cut off by max_tokens', async () => {
    const bad = [
      { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":' } },
      { type: 'content_block_stop' },
      { type: 'content_block_start', content_block: { type: 'tool_use', id: 't2', name: 'Read' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: {} }
    ]
    const { client: c } = client(async () => gen(bad))
    const events = await collect(new AnthropicProvider('k', { client: c }).stream(req()))
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([{ type: 'tool_use', id: 't1', name: 'Read', input: '{"a":' }])
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'max_tokens' })
  })

  it('sends cache_control on the system prompt and the last block of the last message only', async () => {
    const { client: c, create } = client(async () => gen([]))
    await collect(new AnthropicProvider('k', { client: c }).stream(req()))
    const body = (create.mock.calls[0] as any[])[0]
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.messages[0].content[0].cache_control).toBeUndefined()
    expect(body.messages[0].content[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('retries 429/5xx with retry-after, then succeeds', async () => {
    sleep.mockClear()
    const { client: c, create } = client(
      async () => Promise.reject(apiError(429, { 'retry-after': '3' })),
      async () => Promise.reject(apiError(529)),
      async () => gen(happy)
    )
    const events = await collect(new AnthropicProvider('k', { client: c, sleep }).stream(req()))
    expect(create).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((x: any[]) => x[0])).toEqual([3000, 2000]) // retry-after, then exponential (attempt 1)
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' })
  })

  it('gives up after 4 retries', async () => {
    const calls = Array.from({ length: 5 }, () => async () => Promise.reject(apiError(500)))
    const { client: c, create } = client(...calls)
    await expect(collect(new AnthropicProvider('k', { client: c, sleep }).stream(req()))).rejects.toThrow('boom')
    expect(create).toHaveBeenCalledTimes(5)
  })

  it('fails 401 immediately, naming the env var', async () => {
    const { client: c, create } = client(async () => Promise.reject(apiError(401)))
    await expect(collect(new AnthropicProvider('k', { client: c, sleep }).stream(req()))).rejects.toThrow(/ANTHROPIC_API_KEY/)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('does not retry once an event was emitted', async () => {
    const { client: c, create } = client(
      async () => gen([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }], new ProviderError('overloaded', 529)),
      async () => gen(happy)
    )
    const seen: StreamEvent[] = []
    await expect(
      (async () => {
        for await (const e of new AnthropicProvider('k', { client: c, sleep }).stream(req())) seen.push(e)
      })()
    ).rejects.toThrow('overloaded')
    expect(seen).toEqual([{ type: 'text_delta', text: 'x' }])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('treats an in-stream overloaded_error (thrown, no status) before any event as retryable', async () => {
    const { client: c, create } = client(
      // the real SDK throws an APIError without status for in-stream error events
      async () => gen([], Object.assign(new Error('Overloaded'), { status: undefined, error: { type: 'error', error: { type: 'overloaded_error' } } })),
      async () => gen(happy)
    )
    await collect(new AnthropicProvider('k', { client: c, sleep }).stream(req()))
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('knows the context window (default 200k)', async () => {
    const p = new AnthropicProvider('k', { client: client().client })
    expect(await p.contextWindow('claude-sonnet-5-5')).toBe(200_000)
    expect(await p.contextWindow('unknown')).toBe(200_000)
  })
  it('uses max_input_tokens from the models API when the API reports it, and falls back when it does not or the call fails', async () => {
    let calls = 0
    const client = { messages: { create: async () => (async function* () {})() }, models: { list: async function* () { calls++; yield { id: 'big', max_input_tokens: 1_000_000 }; yield { id: 'plain' } } } }
    const p = new AnthropicProvider('k', { client: client as never })
    expect(await p.contextWindow('big')).toBe(1_000_000)
    expect(await p.contextWindow('plain')).toBe(200_000)
    expect(calls).toBe(1) // cached
    const bad = { messages: client.messages, models: { list: () => { throw new Error('down') } } }
    expect(await new AnthropicProvider('k', { client: bad as never }).contextWindow('claude-sonnet-5-5')).toBe(200_000)
  })
})

describe('AnthropicProvider effort', () => {
  it('sends output_config.effort, and omits it when unset', async () => {
    const { create, client: c } = client(async () => gen([]), async () => gen([]))
    await collect(new AnthropicProvider('k', { client: c, sleep }).stream(req({ effort: 'xhigh' })))
    await collect(new AnthropicProvider('k', { client: c, sleep }).stream(req()))
    expect((create.mock.calls[0] as any)[0].output_config).toEqual({ effort: 'xhigh' })
    expect('output_config' in (create.mock.calls[1] as any)[0]).toBe(false)
  })
  it('resends without effort when the model rejects it, and remembers that per model', async () => {
    const rejected = async () => {
      throw Object.assign(new Error('output_config.effort: not supported for this model'), { status: 400, headers: new Headers() })
    }
    const { create, client: c } = client(rejected, async () => gen(happy), async () => gen(happy))
    const p = new AnthropicProvider('k', { client: c, sleep })
    expect((await collect(p.stream(req({ effort: 'medium' })))).at(-1)).toEqual({ type: 'stop', reason: 'tool_use' })
    await collect(p.stream(req({ effort: 'medium' })))
    expect(create.mock.calls.map((call: any) => 'output_config' in call[0])).toEqual([true, false, false])
  })
})
