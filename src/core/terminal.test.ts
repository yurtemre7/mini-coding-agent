import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TerminalEvent } from '../shared/types'
import { Terminal } from './terminal'

const setup = async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'mca-term-')))
  const events: TerminalEvent[] = []
  const t = new Terminal(cwd, (e) => void events.push(e), { kind: 'bash', path: '/bin/sh' })
  const exited = () => new Promise<void>((res) => { const i = setInterval(() => { if (events.some((e) => e.type === 'exit')) { clearInterval(i); res() } }, 5) })
  return { cwd, events, t, exited }
}
const text = (ev: TerminalEvent[]) => ev.flatMap((e) => (e.type === 'out' ? [e.text] : [])).join('')

describe('Terminal', () => {
  it('runs in the workspace, streams output and reports the exit code', async () => {
    const { cwd, events, t, exited } = await setup()
    t.run('pwd; echo err 1>&2; exit 3')
    await exited()
    expect(events[0]).toEqual({ type: 'start', command: 'pwd; echo err 1>&2; exit 3' })
    expect(text(events)).toContain(cwd)
    expect(text(events)).toContain('err')
    expect(events.at(-1)).toEqual({ type: 'exit', code: 3, signal: null })
    expect(t.running).toBe(false)
  })
  it('allows one command at a time and ignores blank input', async () => {
    const { t, exited } = await setup()
    t.run('   ')
    expect(t.running).toBe(false)
    t.run('sleep 5')
    expect(() => t.run('echo no')).toThrow(/already running/)
    t.kill()
    await exited()
    expect(t.running).toBe(false)
  })
  it('stop ends a long command with a signal', async () => {
    const { events, t, exited } = await setup()
    t.run('sleep 30')
    await new Promise((r) => setTimeout(r, 100))
    t.kill()
    await exited()
    expect(events.at(-1)).toMatchObject({ type: 'exit', signal: 'SIGTERM' })
  })
  it('truncates runaway output', async () => {
    const { events, t, exited } = await setup()
    t.run('yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | head -c 2500000')
    await exited()
    expect(text(events)).toContain('output truncated')
    expect(text(events).length).toBeLessThan(1_100_000)
  })
})
