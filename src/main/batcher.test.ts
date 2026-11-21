import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatcher } from './batcher'
import type { ViewEvent } from '../shared/types'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createBatcher', () => {
  it('merges text deltas and flushes once per 30 ms', () => {
    const sent: ViewEvent[][] = []
    const b = createBatcher((e) => sent.push(e))
    b.push({ type: 'text_delta', text: 'a' })
    b.push({ type: 'text_delta', text: 'b' })
    vi.advanceTimersByTime(29)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([[{ type: 'text_delta', text: 'ab' }]])
    b.push({ type: 'text_delta', text: 'c' })
    vi.advanceTimersByTime(30)
    expect(sent).toHaveLength(2)
  })
  it('keeps order across other events and never merges across parents', () => {
    const sent: ViewEvent[][] = []
    const b = createBatcher((e) => sent.push(e))
    b.push({ type: 'text_delta', text: 'a' })
    b.push({ type: 'tool_start', id: '1', name: 'Read', input: {} })
    b.push({ type: 'text_delta', text: 'b' })
    b.push({ type: 'text_delta', text: 'c', parentId: '1' })
    b.flush()
    expect(sent[0].map((e) => (e.type === 'text_delta' ? e.text : e.type))).toEqual(['a', 'tool_start', 'b', 'c'])
  })
  it('does not mutate the caller\'s event, flush() is immediate, dispose drops the queue', () => {
    const sent: ViewEvent[][] = []
    const b = createBatcher((e) => sent.push(e))
    const first: ViewEvent = { type: 'text_delta', text: 'a' }
    b.push(first)
    b.push({ type: 'text_delta', text: 'b' })
    expect(first).toEqual({ type: 'text_delta', text: 'a' })
    b.flush()
    expect(sent).toHaveLength(1)
    b.push({ type: 'turn_start' })
    b.dispose()
    vi.advanceTimersByTime(100)
    expect(sent).toHaveLength(1)
  })
})
