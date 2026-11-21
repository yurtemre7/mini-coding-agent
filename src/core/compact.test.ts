import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../shared/types'
import { AgentSession, runTurn, type Frontend, type TurnOptions } from './agent'
import { buildSummary, isOverflow, lastTodos, renderTranscript, shouldCompact } from './compact'
import { FakeProvider } from './provider/fake'
import { ProviderError } from './provider/retry'
import type { Message, StreamEvent } from './provider/types'
import { parseTranscript } from './session'
import { z } from 'zod'
import type { Tool } from './tool'

const say = (t: string): StreamEvent => ({ type: 'text_delta', text: t })
const end: StreamEvent = { type: 'stop', reason: 'end_turn' }
const usage = (n: number): StreamEvent => ({ type: 'usage', contextTokens: n, outputTokens: 1 })
const user = (t: string): Message => ({ role: 'user', content: [{ type: 'text', text: t }] })
const signal = new AbortController().signal

describe('trigger arithmetic', () => {
  it('counts cached tokens (contextTokens includes them) against 80% of the window', () => {
    expect(shouldCompact(159_999, 200_000)).toBe(false)
    expect(shouldCompact(160_000, 200_000)).toBe(true)
    expect(shouldCompact(1, 0)).toBe(false)
  })
  it('recognises size rejections only', () => {
    expect(isOverflow(new ProviderError('prompt is too long: 250000 tokens > 200000 maximum', 400))).toBe(true)
    expect(isOverflow(new ProviderError('maximum context length is 8192 tokens', 400))).toBe(true)
    expect(isOverflow(new ProviderError('invalid tool schema', 400))).toBe(false)
    expect(isOverflow(new Error('prompt is too long'))).toBe(false)
  })
})

describe('summary', () => {
  const history: Message[] = [
    user('fix the bug'),
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'TodoWrite', input: { todos: [{ content: 'x', status: 'in_progress' }] } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Todos updated.' }] }
  ]
  it('renders tool calls as text and clears the oldest results', () => {
    expect(renderTranscript(history)).toContain('[result of TodoWrite: Todos updated.]')
    expect(renderTranscript(history, 3)).toContain('[cleared]')
  })
  it('finds the newest todo list', () => {
    expect(lastTodos(history)).toEqual([{ content: 'x', status: 'in_progress' }])
  })
  it('sends one tool-less request and re-attaches todos and the reminder', async () => {
    const p = new FakeProvider([[say('SUMMARY'), end]])
    const m = await buildSummary(history, { provider: p, model: 'm', signal, reminder: async () => '<system-reminder>\nInstructions from AGENTS.md: be nice\n</system-reminder>' })
    expect(p.requests[0].tools).toEqual([])
    expect(p.requests[0].messages).toHaveLength(1)
    const text = (m.content[0] as { text: string }).text
    expect(text).toMatch(/^<system-reminder>/)
    expect(text).toContain('SUMMARY')
    expect(text).toContain('[in_progress] x')
    expect(text).toContain('be nice')
  })
  it('clears the oldest half of the tool results and retries once when the summary request is too long', async () => {
    const p = new FakeProvider([
      () => {
        throw new ProviderError('prompt is too long', 400)
      },
      [say('S'), end]
    ])
    const longer: Message[] = [...history, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, user('next')]
    await buildSummary(longer, { provider: p, model: 'm', signal })
    expect(p.requests).toHaveLength(2)
    expect(JSON.stringify(p.requests[1].messages)).toContain('[cleared]')
    expect(JSON.stringify(p.requests[0].messages)).not.toContain('[cleared]')
  })
})

describe('compaction in a turn', () => {
  const echo: Tool = { name: 'Echo', description: 'e', schema: z.object({}), readOnly: true, run: async () => 'ok' }
  function setup(turns: ConstructorParameters<typeof FakeProvider>[0], window = 1000) {
    const events: AgentEvent[] = []
    const frontend: Frontend = { emit: (e) => void events.push(e), ask: async () => ({ allow: false }) }
    const provider = new FakeProvider(turns, window)
    const compacted: Message[] = []
    const opts: TurnOptions = { provider, model: 'm', system: 's', tools: [echo], cwd: '/', frontend, signal, onCompact: (m) => void compacted.push(m) }
    return { events, provider, compacted, opts, history: [] as Message[] }
  }

  it('compacts mid-turn once the context passes 80%, then keeps working', async () => {
    const s = setup([
      [{ type: 'tool_use', id: 't', name: 'Echo', input: {} }, usage(900), { type: 'stop', reason: 'tool_use' }],
      [say('SUM'), end], // the summary
      [say('finished'), end]
    ])
    expect(await runTurn(s.history, 'go', s.opts)).toBe('done')
    expect(s.compacted).toHaveLength(1)
    expect(s.provider.requests).toHaveLength(3)
    expect(s.provider.requests[2].messages).toHaveLength(1) // only the summary
    expect(s.history.at(-1)!.content[0]).toMatchObject({ text: 'finished' })
    expect(s.events).toContainEqual({ type: 'notice', level: 'info', message: expect.stringContaining('compacted') })
  })

  it('on a "prompt too long" rejection compacts once and retries the request', async () => {
    const s = setup([
      () => {
        throw new ProviderError('prompt is too long', 400)
      },
      [say('SUM'), end],
      [say('ok'), end]
    ])
    expect(await runTurn(s.history, 'go', s.opts)).toBe('done')
    expect(s.compacted).toHaveLength(1)
    expect(s.history.at(-1)!.content[0]).toMatchObject({ text: 'ok' })
  })

  it('a second overflow in the same turn is reported, not looped', async () => {
    const boom = () => {
      throw new ProviderError('prompt is too long', 400)
    }
    const s = setup([boom, [say('SUM'), end], boom])
    expect(await runTurn(s.history, 'go', s.opts)).toBe('error')
    expect(s.compacted).toHaveLength(1)
  })

  it('a failed summary leaves the history alone', async () => {
    const s = setup([[say('a'), end], () => { throw new Error('down') }])
    const session = new AgentSession({ ...s.opts })
    await session.send('one')
    const before = JSON.stringify(session.history)
    await expect(session.compact()).rejects.toThrow('down')
    expect(JSON.stringify(session.history)).toBe(before)
    expect(session.busy).toBe(false)
  })
})

describe('session /compact and the transcript boundary', () => {
  it('replaces the history, records a boundary and resumes from it', async () => {
    const records: string[] = []
    const provider = new FakeProvider([[say('a1'), end], [say('SUM'), end]])
    const session = new AgentSession({ provider, model: 'm', system: 's', tools: [], cwd: '/', frontend: { emit: () => {}, ask: async () => ({ allow: false }) } })
    const store = { append: (m: Message) => records.push(JSON.stringify({ type: 'message', ...m })), compact: (m: Message) => records.push(JSON.stringify({ type: 'compact', ...m })), rewind: () => {}, fresh: () => store }
    session.store = store as never
    await session.send('hello')
    expect(await session.compact('the api')).toBe(true)
    expect(session.history).toHaveLength(1)
    expect(provider.requests[1].messages[0].content[0]).toMatchObject({ text: expect.stringContaining('the api') })
    const meta = JSON.stringify({ type: 'meta', version: 1, cwd: '/', provider: 'p', model: 'm', created: '', title: 't' })
    const parsed = parseTranscript([meta, ...records].join('\n'))
    expect(parsed.messages).toHaveLength(1)
    expect(JSON.stringify(parsed.messages[0])).toContain('SUM')
    expect(parsed.damaged).toBe(false)
  })
})
