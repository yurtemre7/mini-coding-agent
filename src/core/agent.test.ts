import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../shared/types'
import { AgentSession, runTurn, sealHistory, type Frontend, type TurnOptions } from './agent'
import { FileState } from './filestate'
import { Hooks } from './hooks'
import { FakeProvider } from './provider/fake'
import type { Message, StreamEvent } from './provider/types'
import type { Tool } from './tool'

const events: AgentEvent[] = []
const frontend = (): Frontend => ({ emit: (e) => void events.push(e), ask: async () => ({ allow: false }) })
const use = (id: string, name: string, input: unknown = {}): StreamEvent => ({ type: 'tool_use', id, name, input })
const stop = (reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'): StreamEvent => ({ type: 'stop', reason })
const text = (t: string): StreamEvent => ({ type: 'text_delta', text: t })

const echo = (over: Partial<Tool> = {}): Tool => ({
  name: 'Echo',
  description: 'echo',
  schema: z.object({ msg: z.string(), n: z.number().optional() }),
  readOnly: true,
  run: async (i: any) => i.msg,
  ...over
})

function setup(turns: ConstructorParameters<typeof FakeProvider>[0], tools: Tool[] = [echo()], extra: Partial<TurnOptions> = {}) {
  events.length = 0
  const provider = new FakeProvider(turns)
  const history: Message[] = []
  const ctl = new AbortController()
  const opts: TurnOptions = { provider, model: 'm', system: 's', tools, cwd: '/', frontend: frontend(), signal: ctl.signal, ...extra }
  return { provider, history, ctl, opts, go: (t = 'hi') => runTurn(history, t, opts) }
}
const results = (h: Message[]) => h.flatMap((m) => m.content).filter((b) => b.type === 'tool_result') as any[]
const reason = () => (events.find((e) => e.type === 'turn_end') as any).reason

describe('runTurn', () => {
  it('streams text, runs a tool, feeds the result back, ends done', async () => {
    const s = setup([[text('a'), use('1', 'Echo', { msg: 'pong' }), { type: 'usage', contextTokens: 5, outputTokens: 1 }, stop('tool_use')], [text('bye'), stop('end_turn')]])
    expect(await s.go()).toBe('done')
    expect(results(s.history)).toEqual([{ type: 'tool_result', tool_use_id: '1', content: 'pong' }])
    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'usage', 'tool_start', 'tool_end', 'text_delta', 'turn_end'])
    expect(events[0].type).toBe('turn_start')
    expect(events.at(-1)).toEqual({ type: 'turn_end', reason: 'done' })
    expect(events).toContainEqual({ type: 'usage', contextTokens: 5, contextWindow: 200_000 })
    expect(s.provider.requests[1].messages.at(-1)!.role).toBe('user') // second request carries the tool result
  })

  it('turns unknown tools, invalid input (listing fields), thrown errors and denials into is_error results', async () => {
    const s = setup(
      [[use('u', 'Nope'), use('v', 'Echo', { msg: 5 }), use('t', 'Echo', { msg: 'boom' }), use('d', 'Echo', { msg: 'x' }), stop('tool_use')], [stop('end_turn')]],
      [echo({ run: async (i: any) => { if (i.msg === 'boom') throw new Error('kaboom'); return 'ok' }, readOnly: false })],
      { decide: async (_t, input: any) => (input.msg === 'x' ? 'blocked by rule' : undefined) }
    )
    await s.go()
    const r = results(s.history)
    expect(r.map((x) => x.is_error)).toEqual([true, true, true, true])
    expect(r[0].content).toContain('Unknown tool "Nope"')
    expect(r[0].content).toContain('Echo')
    expect(r[1].content).toMatch(/msg/)
    expect(r[2].content).toBe('kaboom')
    expect(r[3].content).toBe('Permission denied: blocked by rule')
  })

  it('replaces empty tool output with "(no output)"', async () => {
    const s = setup([[use('1', 'Echo', { msg: '' }), stop('tool_use')], [stop('end_turn')]])
    await s.go()
    expect(results(s.history)[0].content).toBe('(no output)')
  })

  it('max_tokens: drops the truncated tool_use (never runs it) and asks the model to continue in smaller steps', async () => {
    let ran = 0
    const s = setup([[text('part'), use('1', 'Echo', { msg: 'x' }), stop('max_tokens')], [text('ok'), stop('end_turn')]], [echo({ run: async () => (ran++, 'r') })])
    expect(await s.go()).toBe('done')
    expect(ran).toBe(0)
    expect(JSON.stringify(s.history)).not.toContain('tool_use')
    const second = s.provider.requests[1].messages
    expect(second.at(-1)!.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('smaller steps') })
    expect(second.at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'part' }] })
  })

  it('max_tokens with nothing left drops the empty assistant message', async () => {
    const s = setup([[use('1', 'Echo', { msg: 'x' }), stop('max_tokens')], [stop('end_turn')]])
    await s.go()
    expect(s.provider.requests[1].messages.every((m) => m.content.length > 0)).toBe(true)
  })

  it('stops at the iteration cap with a notice', async () => {
    const loop = () => [use('i', 'Echo', { msg: 'x' }), stop('tool_use')] as StreamEvent[]
    const s = setup([loop(), loop(), loop()], [echo()], { maxIterations: 2 })
    expect(await s.go()).toBe('max_iterations')
    expect(s.provider.requests).toHaveLength(2)
    expect(events.some((e) => e.type === 'notice' && e.level === 'warn')).toBe(true)
    expect(reason()).toBe('max_iterations')
  })

  it('provider error: notice, error reason, history sealed', async () => {
    const s = setup([() => (async function* () { yield use('1', 'Echo', { msg: 'x' }); throw new Error('stream died') })()])
    expect(await s.go()).toBe('error')
    expect(events).toContainEqual({ type: 'notice', level: 'error', message: 'stream died' })
    expect(results(s.history)).toEqual([{ type: 'tool_result', tool_use_id: '1', content: 'Interrupted before this tool ran.', is_error: true }])
    expect(reason()).toBe('error')
  })

  it('abort: keeps streamed text, seals history, kills pending asks as denials, reason aborted', async () => {
    const s = setup([(req) => (async function* () { yield text('partial'); yield use('1', 'Echo', { msg: 'x' }); await new Promise((r) => req.signal.addEventListener('abort', r)); yield text('never') })()])
    const p = s.go()
    await new Promise((r) => setTimeout(r, 20))
    s.ctl.abort()
    expect(await p).toBe('aborted')
    expect(s.history[1].content[0]).toEqual({ type: 'text', text: 'partial' })
    expect(results(s.history)[0]).toMatchObject({ tool_use_id: '1', is_error: true })
    expect(reason()).toBe('aborted')
  })

  it('abort resolves a pending ask() as a denial', async () => {
    let askResult: unknown
    const tool = echo({ run: async (_i, ctx) => ((askResult = await ctx.ask({ kind: 'permission', toolName: 'Echo', input: {} })), 'done') })
    const s = setup([[use('1', 'Echo', { msg: 'x' }), stop('tool_use')], [stop('end_turn')]], [tool], {
      frontend: { emit: () => {}, ask: () => new Promise(() => {}) } // never answers
    })
    const p = s.go()
    await new Promise((r) => setTimeout(r, 20))
    s.ctl.abort()
    await p
    expect(askResult).toMatchObject({ allow: false })
  })

  it('ask() after abort resolves immediately as a denial', async () => {
    let askResult: unknown
    const tool = echo({
      run: async (_i, ctx) => {
        await new Promise((r) => ctx.signal.addEventListener('abort', r))
        askResult = await ctx.ask({ kind: 'permission', toolName: 'Echo', input: {} })
        return 'done'
      }
    })
    const s = setup([[use('1', 'Echo', { msg: 'x' }), stop('tool_use')]], [tool], { frontend: { emit: () => {}, ask: () => new Promise(() => {}) } })
    const p = s.go()
    await new Promise((r) => setTimeout(r, 20))
    s.ctl.abort()
    await p
    expect(askResult).toMatchObject({ allow: false })
  })

  it('batches consecutive read-only calls in parallel (max 8), non-read-only alone, results in call order', async () => {
    const log: string[] = []
    let inflight = 0
    let peak = 0
    const slow = (name: string, readOnly: boolean, ms: number): Tool => ({
      name, description: '', schema: z.object({}), readOnly,
      run: async () => { log.push(`start ${name}`); inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, ms)); inflight--; log.push(`end ${name}`); return name }
    })
    const calls = [...Array.from({ length: 10 }, (_, i) => use(`r${i}`, 'R', {})), use('w', 'W', {}), use('r10', 'R', {}), stop('tool_use')]
    const s = setup([calls, [stop('end_turn')]], [slow('R', true, 20), slow('W', false, 5)])
    await s.go()
    expect(peak).toBe(8)
    expect(results(s.history).map((r) => r.tool_use_id)).toEqual([...Array.from({ length: 10 }, (_, i) => `r${i}`), 'w', 'r10'])
    const w = log.indexOf('start W')
    expect(log.slice(0, w).filter((l) => l.startsWith('end R'))).toHaveLength(10) // all reads finished before the write started
    expect(log[w + 1]).toBe('end W') // write ran alone
    expect(log.indexOf('start R', w)).toBeGreaterThan(w + 1) // trailing read starts after the write ends
  })

  it('classifies read-only per call when readOnly is a function', async () => {
    let inflight = 0
    let peak = 0
    const t = echo({ readOnly: (i: any) => i.msg === 'ro', run: async () => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 10)); inflight--; return 'x' } })
    const s = setup([[use('1', 'Echo', { msg: 'rw' }), use('2', 'Echo', { msg: 'rw' }), stop('tool_use')], [stop('end_turn')]], [t])
    await s.go()
    expect(peak).toBe(1)
  })
})

describe('sealHistory', () => {
  it('drops empty assistant messages and adds tool_results first in the following user message', () => {
    const h: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'X', input: {} }, { type: 'tool_use', id: 'b', name: 'X', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ra' }, { type: 'text', text: 'next' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'X', input: {} }] }
    ]
    sealHistory(h)
    expect(h).toHaveLength(5)
    expect(h[2].content.map((b: any) => b.tool_use_id ?? b.text)).toEqual(['b', 'a', 'next'])
    expect(h[4]).toMatchObject({ role: 'user', content: [{ tool_use_id: 'c', is_error: true, content: 'Interrupted before this tool ran.' }] })
    const before = JSON.stringify(h)
    sealHistory(h)
    expect(JSON.stringify(h)).toBe(before) // idempotent
  })
})

describe('AgentSession', () => {
  it('rejects a second send while a turn is running', async () => {
    events.length = 0
    const provider = new FakeProvider([() => (async function* () { await new Promise((r) => setTimeout(r, 30)); yield stop('end_turn') })()])
    const session = new AgentSession({ provider, model: 'm', system: 's', tools: [], cwd: '/', frontend: frontend() })
    const first = session.send('a')
    await expect(session.send('b')).rejects.toThrow(/already running/)
    expect(await first).toBe('done')
    expect(session.busy).toBe(false)
  })
})

describe('checkpoints', () => {
  it('runTurn pushes one checkpoint entry per turn', async () => {
    const files = new FileState()
    const { go } = setup([[stop('end_turn')], [stop('end_turn')]], [echo()], { files })
    await go()
    await go()
    expect(await files.rewind()).toEqual([])
    expect(await files.rewind()).toEqual([])
    expect(await files.rewind()).toBeUndefined()
  })
})

describe('resumed checkpoints', () => {
  it('rewinding a turn from an earlier run restores files only and says so', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { Transcript } = await import('./session')
    const { runCommand } = await import('./commands')
    const { Permissions } = await import('./permissions')
    const home = mkdtempSync(join(tmpdir(), 'mca-rs-'))
    const cwd = mkdtempSync(join(tmpdir(), 'mca-rsw-'))
    const file = join(cwd, 'a.txt')
    writeFileSync(file, 'orig')
    const meta = () => ({ provider: 'fake', model: 'm' })
    const t1 = new Transcript(cwd, meta, { home })
    const first = new FileState()
    await first.attach(new (await import('./checkpoints')).CheckpointStore(t1.checkpointDir))
    first.beginTurn()
    await first.record(file)
    writeFileSync(file, 'edited')
    const out: string[] = []
    const { opts } = setup([], [echo()])
    const s = new AgentSession({ provider: opts.provider, model: 'm', system: 's', tools: [], cwd, frontend: opts.frontend, decide: async () => undefined })
    s.load([], t1) // a new run opens the same chat
    await s.files.attach(new (await import('./checkpoints')).CheckpointStore(t1.checkpointDir)) // wait for the load
    await runCommand('rewind', '', { session: s, perms: new Permissions({ mode: 'default', canAsk: false }), workspace: cwd, print: (m) => void out.push(m), exit() {}, trustWorkspace: async () => {} })
    expect(readFileSync(file, 'utf8')).toBe('orig')
    expect(out.at(-1)).toMatch(/Restored files.*conversation is unchanged/)
  })
})

describe('hooks and context in the loop', () => {
  const hooks = (c: any) => new Hooks(c, process.cwd())
  it('a PreToolUse hook that exits 2 blocks the tool and feeds stderr to the model', async () => {
    const s = setup([[use('1', 'Echo', { msg: 'rm' }), stop('tool_use')], [stop('end_turn')]], [echo()], { hooks: hooks({ PreToolUse: [{ matcher: 'Echo', command: 'echo nope >&2; exit 2' }] }) })
    await s.go()
    expect(results(s.history)[0]).toMatchObject({ is_error: true })
    expect(results(s.history)[0].content).toContain('nope')
  })
  it('the reminder goes into the first user message only; the system prompt is untouched', async () => {
    const s = setup([[text('a'), stop('end_turn')], [text('b'), stop('end_turn')]], [echo()], { reminder: async () => '<system-reminder>ctx</system-reminder>' })
    await s.go('one')
    await runTurn(s.history, 'two', s.opts)
    expect(s.history[0].content[0]).toEqual({ type: 'text', text: '<system-reminder>ctx</system-reminder>' })
    expect(JSON.stringify(s.history[2])).not.toContain('ctx')
    expect(s.provider.requests.every((r) => r.system === 's')).toBe(true)
  })
  it('a UserPromptSubmit block ends the turn without calling the model', async () => {
    const s = setup([], [echo()], { hooks: hooks({ UserPromptSubmit: [{ command: 'echo banned >&2; exit 2' }] }) })
    expect(await s.go()).toBe('done')
    expect(s.provider.requests).toHaveLength(0)
    expect(s.history).toHaveLength(0)
    expect(events.some((e) => e.type === 'notice' && e.message.includes('banned'))).toBe(true)
  })
  it('a blocking Stop hook continues the turn, sets stop_hook_active, and is capped at 3 blocks', async () => {
    const turns = Array.from({ length: 6 }, () => [text('x'), stop('end_turn')] as StreamEvent[])
    const s = setup(turns, [echo()], { hooks: hooks({ Stop: [{ command: 'echo again >&2; exit 2' }] }) })
    await s.go()
    expect(s.provider.requests).toHaveLength(4) // first answer + 3 forced continuations
    expect(events.some((e) => e.type === 'notice' && e.message.includes('3 times'))).toBe(true)
  })
  it('a broken hook never bricks the turn', async () => {
    const s = setup([[stop('end_turn')]], [echo()], { hooks: hooks({ UserPromptSubmit: [{ command: 'exit 7' }] }) })
    expect(await s.go()).toBe('done')
    expect(events.some((e) => e.type === 'notice' && e.level === 'warn')).toBe(true)
  })
})
