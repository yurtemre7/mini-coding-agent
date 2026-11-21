import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentSession, type Frontend } from './agent'
import { expandCommand, HELP, loadCommands, parseInput, runCommand, type CommandEnv } from './commands'
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
  it('/compact on an empty chat says so, and otherwise replaces the history with a summary', async () => {
    const { out, env, session } = setup([done, [{ type: 'text_delta', text: 'SUM' }, { type: 'stop', reason: 'end_turn' }]])
    await runCommand('compact', '', env)
    expect(out.at(-1)).toBe('Nothing to compact.')
    await session.send('hi')
    await runCommand('compact', 'tests', env)
    expect(session.history).toHaveLength(1)
    expect(JSON.stringify(session.history[0])).toContain('SUM')
  })
})

describe('custom commands', () => {
  const mk = () => {
    const home = mkdtempSync(join(tmpdir(), 'mca-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'mca-proj-'))
    const put = (base: string, rel: string, text: string) => {
      mkdirSync(join(base, dirname(rel)), { recursive: true })
      writeFileSync(join(base, rel), text)
    }
    return { home, cwd, put }
  }
  it('loads commands, project beats home, built-ins are never shadowed', async () => {
    const { home, cwd, put } = mk()
    put(home, '.mca/commands/fix.md', '---\ndescription: from home\n---\nHome fix')
    put(cwd, '.mca/commands/fix.md', 'Project fix $ARGUMENTS')
    put(cwd, '.mca/commands/help.md', 'shadow')
    const cmds = await loadCommands(cwd, { home })
    expect(cmds.map((c) => c.name)).toEqual(['fix'])
    expect(cmds[0].body).toBe('Project fix $ARGUMENTS')
    expect(parseInput('/help', cmds)).toEqual({ kind: 'command', name: 'help', args: '' })
  })
  it('expands $ARGUMENTS and $1..$9, and appends arguments when the body uses neither', () => {
    expect(expandCommand('Fix $ARGUMENTS now', 'a b')).toBe('Fix a b now')
    expect(expandCommand('Swap $2 and $1', 'x y')).toBe('Swap y and x')
    expect(expandCommand('Do it', 'extra')).toContain('Arguments: extra')
    expect(expandCommand('Do it', '')).toBe('Do it')
  })
  it('a custom command becomes a prompt', () => {
    const c = { name: 'fix', description: '', body: 'Fix $1', file: 'x' }
    expect(parseInput('/fix bug', [c])).toEqual({ kind: 'prompt', text: 'Fix bug' })
  })
  it('/model and /provider show, set and reject; /help lists custom commands', async () => {
    const { env, out } = setup([])
    const set: string[] = []
    env.models = { current: () => ({ provider: 'anthropic', model: 'm1' }), providers: ['anthropic', 'openrouter'], setModel: async (id) => void set.push(id), setProvider: async () => 'dflt' }
    await runCommand('model', '', env)
    expect(out.at(-1)).toContain('m1')
    await runCommand('model', 'm2', env)
    expect(set).toEqual(['m2'])
    await runCommand('provider', 'nope', env)
    expect(out.at(-1)).toMatch(/Unknown provider/)
    await runCommand('provider', 'openrouter', env)
    expect(out.at(-1)).toContain('dflt')
  })
})
