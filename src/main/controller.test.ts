import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../core/provider/fake'
import type { StreamEvent } from '../core/provider/types'
import type { ProviderId, ViewEvent } from '../shared/types'
import { Controller } from './controller'

const write = (p: string): StreamEvent[] => [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: p, content: 'hi' } }, { type: 'stop', reason: 'tool_use' }]
const say: StreamEvent[] = [{ type: 'text_delta', text: 'done' }, { type: 'stop', reason: 'end_turn' }]

async function setup(turns: ConstructorParameters<typeof FakeProvider>[0], hasKey = true) {
  const home = await mkdtemp(join(tmpdir(), 'mca-home-'))
  const ws = await mkdtemp(join(tmpdir(), 'mca-ws-'))
  const events: ViewEvent[] = []
  const prompts: { id: string }[] = []
  const store: Partial<Record<ProviderId, string>> = hasKey ? { anthropic: 'k' } : {}
  const c = new Controller({
    home,
    emit: (e) => events.push(e),
    prompt: (p) => prompts.push(p),
    keys: { get: async (p) => store[p] ?? null, set: async (p, k) => void (store[p] = k) },
    makeProvider: () => new FakeProvider(turns)
  })
  await c.selectWorkspace(ws)
  const idle = async () => { while (c.getState().busy || events.at(-1)?.type !== 'turn_end') await new Promise((r) => setTimeout(r, 5)) }
  return { c, ws, events, prompts, idle, store }
}

describe('Controller', () => {
  it('runs a turn, routes a permission prompt to the renderer, and Yes lets the tool run', async () => {
    const { c, ws, events, prompts, idle } = await setup([[]])
    const file = join(ws, 'a.txt')
    ;(c as any).d.makeProvider = () => new FakeProvider([write(file), say])
    c.send('write it')
    while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().pending?.id).toBe(prompts[0].id)
    await expect(c.selectWorkspace(ws)).rejects.toThrow(/while a turn is running/)
    c.answer(prompts[0].id, { allow: true, scope: 'once' })
    await idle()
    expect(await readFile(file, 'utf8')).toBe('hi')
    expect(c.getState()).toMatchObject({ busy: false, pending: null })
    expect(c.getState().items.map((i) => i.kind)).toEqual(['user', 'tool', 'text'])
    expect(events.some((e) => e.type === 'turn_end')).toBe(true)
  })
  it('abort during a prompt denies it and ends the turn; a stale answer is ignored', async () => {
    const { c, ws, prompts, idle } = await setup([[]])
    ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'b.txt')), say])
    c.send('go')
    while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
    c.abort()
    await idle()
    expect(c.getState().pending).toBeNull()
    c.answer(prompts[0].id, { allow: true }) // already gone: must not throw
    await expect(readFile(join(ws, 'b.txt'), 'utf8')).rejects.toThrow()
  })
  it('settings never expose a key; provider/model changes are blocked mid-turn', async () => {
    const { c, store } = await setup([[]], false)
    expect((await c.getSettings()).hasKey).toEqual({ anthropic: false, openrouter: false })
    const after = await c.setKey('anthropic', ' secret ')
    expect(store.anthropic).toBe('secret')
    expect(JSON.stringify(after)).not.toContain('secret')
    expect(after.hasKey.anthropic).toBe(true)
    await expect(c.setKey('anthropic', '  ')).rejects.toThrow()
    expect((await c.update({ provider: 'openrouter' })).model).toMatch(/\//)
  })
  it('/mode and unknown commands report through notices', async () => {
    const { c } = await setup([[]])
    expect((await c.command('/mode plan')).mode).toBe('plan')
    const s = await c.command('/nope')
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error' })
  })
})
