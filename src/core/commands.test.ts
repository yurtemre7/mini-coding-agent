import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentSession, type Frontend } from './agent'
import { HELP, parseInput, runCommand, type CommandEnv } from './commands'
import { Permissions } from './permissions'
import { FakeProvider } from './provider/fake'
import { builtinTools } from './registry'

describe('parseInput', () => {
  it('commands, unknown names, path-like input and plain prompts', () => {
    expect(parseInput('/mode plan')).toEqual({ kind: 'command', name: 'mode', args: 'plan' })
    expect(parseInput('  /exit ')).toEqual({ kind: 'command', name: 'exit', args: '' })
    expect(parseInput('/nope x')).toEqual({ kind: 'unknown', name: 'nope' })
    expect(parseInput('/Users/me/app/file.ts explain this')).toMatchObject({ kind: 'prompt' })
    expect(parseInput('/etc/hosts')).toMatchObject({ kind: 'prompt' })
    expect(parseInput('hello /mode')).toMatchObject({ kind: 'prompt' })
  })
  it('/help states the checkpoint limits', () => {
    expect(HELP).toMatch(/memory/)
    expect(HELP).toMatch(/Bash/)
  })
})

const tool = (id: string, name: string, input: object) => [{ type: 'tool_use' as const, id, name, input }, { type: 'stop' as const, reason: 'tool_use' as const }]
const done = [{ type: 'text_delta' as const, text: 'ok' }, { type: 'stop' as const, reason: 'end_turn' as const }]
const fe: Frontend = { emit() {}, ask: async () => ({ allow: false }) }

function setup(turns: any[]) {
  const dir = mkdtempSync(join(tmpdir(), 'mca-cmd-'))
  const perms = new Permissions({ mode: 'bypassPermissions', canAsk: false })
  const session = new AgentSession({ provider: new FakeProvider(turns), model: 'm', system: 's', tools: builtinTools, cwd: dir, frontend: fe, decide: perms.decide })
  const out: string[] = []
  const env: CommandEnv = { session, perms, workspace: dir, print: (m) => void out.push(m), exit() {}, trustWorkspace: async () => {} }
  return { dir, session, perms, out, env }
}

describe('/rewind', () => {
  it('restores edited and created files, drops the turn from history, and steps back repeatedly', async () => {
    const { dir, session, out, env } = setup([
      [...tool('1', 'Read', { file_path: 'a.txt' })],
      [...tool('2', 'Edit', { file_path: 'a.txt', old_string: 'orig', new_string: 'edited' })],
      done,
      [...tool('3', 'Write', { file_path: 'b.txt', content: 'new' })],
      done
    ])
    writeFileSync(join(dir, 'a.txt'), 'orig')
    await session.send('edit it')
    const afterFirst = session.history.length
    await session.send('make b')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('edited')
    expect(existsSync(join(dir, 'b.txt'))).toBe(true)

    await runCommand('rewind', '', env)
    expect(existsSync(join(dir, 'b.txt'))).toBe(false)
    expect(session.history.length).toBe(afterFirst)
    expect(out.at(-1)).toContain('b.txt')

    await runCommand('rewind', '', env)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('orig')
    expect(session.history).toEqual([])
    expect(out.at(-1)).toContain('a.txt')

    await runCommand('rewind', '', env)
    expect(out.at(-1)).toBe('Nothing to rewind.')
  })
})

describe('/mode, /clear, unavailable', () => {
  it('/mode shows, sets and rejects', async () => {
    const { perms, out, env } = setup([])
    await runCommand('mode', '', env)
    expect(out.at(-1)).toContain('bypassPermissions')
    await runCommand('mode', 'plan', env)
    expect(perms.mode).toBe('plan')
    await runCommand('mode', 'yolo', env)
    expect(perms.mode).toBe('plan')
    expect(out.at(-1)).toContain('Unknown mode')
  })
  it('/clear resets history and checkpoints', async () => {
    const { session, env } = setup([done])
    await session.send('hi')
    await runCommand('clear', '', env)
    expect(session.history).toEqual([])
    expect(await session.rewind()).toBeUndefined()
  })
  it('/compact says it is not available yet', async () => {
    const { out, env } = setup([])
    await runCommand('compact', '', env)
    expect(out.at(-1)).toContain('not available yet')
  })
})
