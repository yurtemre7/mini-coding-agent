import { describe, expect, it } from 'vitest'
import { emptyView, messagesToEvents, reduce } from './reducer'
import type { ViewEvent } from './types'

const run = (events: ViewEvent[]) => events.reduce(reduce, emptyView())

describe('reduce', () => {
  it('coalesces consecutive text deltas into one item', () => {
    const s = run([{ type: 'turn_start' }, { type: 'text_delta', text: 'Hel' }, { type: 'text_delta', text: 'lo' }])
    expect(s.items).toEqual([{ kind: 'text', text: 'Hello' }])
    expect(s.busy).toBe(true)
  })
  it('text after a tool starts a new item; subagent text (parentId) stays separate', () => {
    const s = run([
      { type: 'text_delta', text: 'a' },
      { type: 'tool_start', id: 't1', name: 'Task', input: {} },
      { type: 'text_delta', text: 'sub', parentId: 't1' },
      { type: 'text_delta', text: 'b' }
    ])
    expect(s.items.map((i) => i.kind)).toEqual(['text', 'tool', 'text', 'text'])
    expect(s.items[2]).toMatchObject({ text: 'sub', parentId: 't1' })
  })
  it('tool_start then tool_end completes the matching card only', () => {
    const s = run([
      { type: 'tool_start', id: 'a', name: 'Read', input: { file_path: 'x' } },
      { type: 'tool_start', id: 'b', name: 'Bash', input: {}, parentId: 'a' },
      { type: 'tool_end', id: 'b', result: 'boom', isError: true }
    ])
    expect(s.items[0]).toMatchObject({ id: 'a', done: false })
    expect(s.items[1]).toMatchObject({ id: 'b', parentId: 'a', done: true, result: 'boom', isError: true })
  })
  it('usage accumulates this chat\'s request tokens and ignores estimates without them', () => {
    const s = [
      { type: 'usage', contextTokens: 10, contextWindow: 100, inputTokens: 10, outputTokens: 2 },
      { type: 'usage', contextTokens: 30, contextWindow: 100, inputTokens: 30, outputTokens: 5 },
      { type: 'usage', contextTokens: 12, contextWindow: 100 }
    ].reduce((st, e) => reduce(st, e as never), emptyView())
    expect(s.usage).toEqual({ contextTokens: 12, contextWindow: 100, totalIn: 40, totalOut: 7, costPartial: true }) // no price for these requests
  })
  it('usage sums request costs, and marks the total partial when a priced chat meets an unpriced request', () => {
    const priced = [
      { type: 'usage', contextTokens: 10, contextWindow: 100, inputTokens: 10, outputTokens: 2, costUsd: 0.01 },
      { type: 'usage', contextTokens: 30, contextWindow: 100, inputTokens: 30, outputTokens: 5, costUsd: 0.02 },
      { type: 'usage', contextTokens: 12, contextWindow: 100 } // estimate after compaction: not a request
    ].reduce((st, e) => reduce(st, e as never), emptyView())
    expect(priced.usage?.totalCostUsd).toBeCloseTo(0.03, 10)
    expect(priced.usage?.costPartial).toBeUndefined()
    const mixed = reduce(priced, { type: 'usage', contextTokens: 5, contextWindow: 100, inputTokens: 5, outputTokens: 1 })
    expect(mixed.usage).toMatchObject({ costPartial: true })
    expect(mixed.usage?.totalCostUsd).toBeCloseTo(0.03, 10)
  })
  it('turn_end clears busy; usage, todos and notices are recorded', () => {
    const s = run([
      { type: 'turn_start' },
      { type: 'usage', contextTokens: 10, contextWindow: 100 },
      { type: 'todos', todos: [{ content: 'x', status: 'pending' }] },
      { type: 'notice', level: 'warn', message: 'careful' },
      { type: 'turn_end', reason: 'done' }
    ])
    expect(s).toMatchObject({ busy: false, usage: { contextTokens: 10, contextWindow: 100 }, todos: [{ content: 'x', status: 'pending' }] })
    expect(s.items).toEqual([{ kind: 'notice', level: 'warn', message: 'careful' }])
  })
  it('rewind drops the newest turn from its user message on; clear empties everything', () => {
    const turn = (t: string): ViewEvent[] => [{ type: 'user_message', text: t }, { type: 'text_delta', text: `re ${t}` }]
    const s = run([...turn('one'), ...turn('two'), { type: 'rewind' }])
    expect(s.items).toEqual([{ kind: 'user', text: 'one' }, { kind: 'text', text: 're one' }])
    expect(reduce(s, { type: 'clear' }).items).toEqual([])
  })
  it('does not mutate the previous state', () => {
    const a = run([{ type: 'text_delta', text: 'a' }])
    reduce(a, { type: 'text_delta', text: 'b' })
    expect(a.items).toEqual([{ kind: 'text', text: 'a' }])
  })
  it('messagesToEvents rebuilds the same items a live turn produced', () => {
    const items = run(
      messagesToEvents([
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 't', name: 'Read', input: { p: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'out', is_error: true }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] }
      ])
    ).items
    expect(items).toEqual([
      { kind: 'user', text: 'go' },
      { kind: 'text', text: 'a' },
      { kind: 'tool', id: 't', name: 'Read', input: { p: 1 }, done: true, result: 'out', isError: true },
      { kind: 'text', text: 'b' }
    ])
  })
})

describe('messagesToEvents todos', () => {
  it('replays a TodoWrite call as a todos event and skips malformed entries', () => {
    const events = messagesToEvents([{ role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'pending' }, { nope: 1 }] } }] }])
    expect(events).toContainEqual({ type: 'todos', todos: [{ content: 'a', status: 'pending' }] })
  })
})

describe('changes', () => {
  const c = { path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, binary: false, tooLarge: false }
  it('a changes event replaces the state; clear and rewind reset it', () => {
    const s0 = reduce(emptyView(), { type: 'user_message', text: 'hi' })
    const s1 = reduce(s0, { type: 'changes', turn: [c], total: [c] })
    expect(s1.changes).toEqual({ turn: [c], total: [c] })
    expect(reduce(s1, { type: 'rewind' }).changes).toEqual({ turn: [], total: [] })
    expect(reduce(s1, { type: 'clear' }).changes).toEqual({ turn: [], total: [] })
  })
})
