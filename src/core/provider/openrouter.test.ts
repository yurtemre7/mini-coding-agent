import { describe, expect, it, vi } from 'vitest'
import { OpenRouterProvider, openRouterEvents, sseData, toOpenAI } from './openrouter'
import type { StreamEvent, StreamRequest } from './types'

const enc = new TextEncoder()
async function* chunks(...parts: string[]) {
  for (const p of parts) yield enc.encode(p)
}
const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = []
  for await (const e of it) out.push(e)
  return out
}
const run = (...parts: string[]) => collect(openRouterEvents(sseData(chunks(...parts))))
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
const delta = (d: object, finish: string | null = null) => sse({ choices: [{ delta: d, finish_reason: finish }] })

describe('sseData', () => {
  it('ignores comments, handles split lines and CRLF, stops at nothing but yields [DONE]', async () => {
    const out = await collect(sseData(chunks(': keep-alive\n\ndata: {"a"', ':1}\r\n\r\n: ping\n\nda', 'ta: [DONE]\n\n')))
    expect(out).toEqual(['{"a":1}', '[DONE]'])
  })
  it('splits a multi-byte character across chunks without corruption', async () => {
    const bytes = enc.encode('data: "é"\n\n')
    async function* split() {
      yield bytes.slice(0, 8)
      yield bytes.slice(8)
    }
    expect(await collect(sseData(split()))).toEqual(['"é"'])
  })
})

describe('openRouterEvents', () => {
  it('streams text, concatenates fragmented tool args by index, uses provider usage', async () => {
    const events = await run(
      ': OPENROUTER PROCESSING\n\n',
      delta({ content: 'Hi' }),
      delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"file_' } }] }),
      delta({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'Read', arguments: '{"file_path":"b"}' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: 'path":"a"}' } }] }, 'tool_calls'),
      sse({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } }),
      'data: [DONE]\n\n'
    )
    expect(events).toEqual<StreamEvent[]>([
      { type: 'text_delta', text: 'Hi' },
      { type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a' } },
      { type: 'tool_use', id: 'c2', name: 'Read', input: { file_path: 'b' } },
      { type: 'usage', contextTokens: 50, outputTokens: 9 },
      { type: 'stop', reason: 'tool_use' }
    ])
  })

  it('emits a tool_use with the raw string when arguments do not parse', async () => {
    const events = await run(delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'Read', arguments: '{oops' } }] }, 'tool_calls'), 'data: [DONE]\n\n')
    expect(events[0]).toEqual({ type: 'tool_use', id: 'c', name: 'Read', input: '{oops' })
  })

  it('passes through the cost OpenRouter reports', async () => {
    const events = await run(delta({ content: 'x' }), sse({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.0042 } }), 'data: [DONE]\n\n')
    expect(events).toContainEqual({ type: 'usage', contextTokens: 5, outputTokens: 1, costUsd: 0.0042 })
  })
  it('maps length to max_tokens and estimates usage (chars/4) when none is sent', async () => {
    const events = await run(delta({ content: 'abcdefgh' }, 'length'), 'data: [DONE]\n\n')
    expect(events).toContainEqual({ type: 'usage', contextTokens: 0, outputTokens: 2 })
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'max_tokens' })
  })

  it('treats an error chunk on a 200 stream as a provider error', async () => {
    await expect(run(delta({ content: 'x' }), sse({ error: { code: 502, message: 'upstream died' } }))).rejects.toMatchObject({
      message: 'upstream died',
      status: 502
    })
  })
})

describe('toOpenAI', () => {
  it('N tool_use blocks -> one assistant message with N tool_calls; each result its own tool message after it', () => {
    const out = toOpenAI('sys', [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'a', name: 'Read', input: { p: 1 } }, { type: 'tool_use', id: 'b', name: 'Read', input: { p: 2 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ra' }, { type: 'tool_result', tool_use_id: 'b', content: 'rb', is_error: true }] }
    ]) as any[]
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool'])
    expect(out[2].tool_calls).toHaveLength(2)
    expect(out[2].tool_calls[0]).toMatchObject({ id: 'a', function: { name: 'Read', arguments: '{"p":1}' } })
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'ra' })
  })
})

describe('OpenRouterProvider', () => {
  const req = (): StreamRequest => ({ model: 'm', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [{ name: 'Read', description: 'd', input_schema: { type: 'object' } }], maxTokens: 5, signal: new AbortController().signal })
  const ok = (body: string) => new Response(body, { status: 200 })
  const sleep = vi.fn(async () => {})

  it('posts with usage.include and tools, retries 429 honouring retry-after, then streams', async () => {
    sleep.mockClear()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(ok(delta({ content: 'yo' }, 'stop') + 'data: [DONE]\n\n'))
    const events = await collect(new OpenRouterProvider('key', { fetch, sleep }).stream(req()))
    expect(sleep).toHaveBeenCalledWith(2000, expect.anything())
    const [url, init] = fetch.mock.calls[1]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ stream: true, usage: { include: true }, tools: [{ type: 'function', function: { name: 'Read' } }] })
    expect(events[0]).toEqual({ type: 'text_delta', text: 'yo' })
  })

  it('sends reasoning.effort, mapping xhigh and max to high', async () => {
    const sent: any[] = []
    for (const effort of ['low', 'xhigh', 'max'] as const) {
      const fetch = vi.fn().mockResolvedValue(ok(delta({ content: 'y' }, 'stop') + 'data: [DONE]\n\n'))
      await collect(new OpenRouterProvider('key', { fetch, sleep }).stream({ ...req(), effort }))
      sent.push(JSON.parse(fetch.mock.calls[0][1].body).reasoning)
    }
    expect(sent).toEqual([{ effort: 'low' }, { effort: 'high' }, { effort: 'high' }])
  })

  it('fails 401 immediately, naming the env var', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('no', { status: 401 }))
    await expect(collect(new OpenRouterProvider('k', { fetch, sleep }).stream(req()))).rejects.toThrow(/OPENROUTER_API_KEY/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('listModels returns sorted ids from the same cached fetch; 401 names the env var', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b:free', context_length: 1 }, { id: 'a', context_length: 2 }] })))
    const p = new OpenRouterProvider('k', { fetch })
    expect(await p.listModels()).toEqual([{ id: 'a' }, { id: 'b:free', free: true }])
    expect(await p.contextWindow('a')).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(1)
    const denied = new OpenRouterProvider('k', { fetch: vi.fn().mockResolvedValue(new Response('no', { status: 401 })) })
    await expect(denied.listModels()).rejects.toThrow(/OPENROUTER_API_KEY/)
  })

  it('fetches context_length once and caches it; falls back to 128k', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'big', context_length: 1_000_000 }] })))
    const p = new OpenRouterProvider('k', { fetch })
    expect(await p.contextWindow('big')).toBe(1_000_000)
    expect(await p.contextWindow('other')).toBe(128_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await new OpenRouterProvider('k', { fetch: vi.fn().mockRejectedValue(new Error('offline')) }).contextWindow('big')).toBe(128_000)
  })
})
