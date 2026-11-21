import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Hooks, matches, parseHooks, type HookConfig } from './hooks'
import { loadSettings } from './settings'

const dir = () => mkdtempSync(join(tmpdir(), 'mca-hooks-'))
const cfg = (event: keyof HookConfig, command: string, matcher?: string): HookConfig => ({ [event]: [{ command, matcher }] })

describe('parseHooks', () => {
  it('reads the Claude-style nested format', () => {
    const { config, warnings } = parseHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x.sh', timeout: 5 }] }] }, 's')
    expect(config.PreToolUse).toEqual([{ matcher: 'Bash', command: 'x.sh', timeoutMs: 5000 }])
    expect(warnings).toEqual([])
  })
  it('skips malformed entries with warnings and never throws', () => {
    const { config, warnings } = parseHooks({ Nope: [], Stop: 'x', PreToolUse: [{ hooks: [{ type: 'http' }] }, 5] }, 's')
    expect(config).toEqual({})
    expect(warnings.length).toBe(4)
    expect(parseHooks([], 's').warnings).toHaveLength(1)
  })
})

describe('matches', () => {
  it('matches whole tool names by regex; * and empty match all; a broken regex falls back to equality', () => {
    expect(matches('Bash', 'Bash')).toBe(true)
    expect(matches('Bash', 'BashX')).toBe(false)
    expect(matches('Edit|Write', 'Write')).toBe(true)
    expect(matches('*', 'Read')).toBe(true)
    expect(matches(undefined, 'Read')).toBe(true)
    expect(matches('(', '(')).toBe(true)
  })
})

describe('Hooks.run exit codes', () => {
  const run = (c: HookConfig, tool = 'Bash') => new Hooks(c, dir()).run('PreToolUse', { tool_name: tool }, { toolName: tool })
  it('exit 0 continues and keeps stdout', async () => {
    expect(await run(cfg('PreToolUse', 'echo hello'))).toEqual({ output: ['hello'], warnings: [] })
  })
  it('exit 2 blocks with stderr', async () => {
    expect((await run(cfg('PreToolUse', 'echo no rm >&2; exit 2'))).block).toBe('no rm')
  })
  it('any other exit code is only a warning', async () => {
    const r = await run(cfg('PreToolUse', 'echo oops >&2; exit 1'))
    expect(r.block).toBeUndefined()
    expect(r.warnings[0]).toContain('exited with code 1')
  })
  it('a timeout is a warning', async () => {
    const r = await new Hooks({ PreToolUse: [{ command: 'sleep 5', timeoutMs: 100 }] }, dir()).run('PreToolUse', {}, { toolName: 'Bash' })
    expect(r.block).toBeUndefined()
    expect(r.warnings[0]).toContain('timed out')
  })
  it('a spawn failure (bad cwd) is a warning', async () => {
    const r = await new Hooks(cfg('PreToolUse', 'true'), '/definitely/not/here').run('PreToolUse', {}, { toolName: 'Bash' })
    expect(r.block).toBeUndefined()
    expect(r.warnings).toHaveLength(1)
  })
  it('the matcher filters by tool name', async () => {
    expect(await run(cfg('PreToolUse', 'exit 2', 'Bash'), 'Read')).toEqual({ output: [], warnings: [] })
    expect((await run(cfg('PreToolUse', 'exit 2', 'Bash'), 'Bash')).block).toBeDefined()
  })
  it('passes the event as JSON on stdin', async () => {
    const r = await new Hooks(cfg('Stop', 'cat'), dir()).run('Stop', { stop_hook_active: true })
    expect(JSON.parse(r.output[0])).toMatchObject({ hook_event_name: 'Stop', stop_hook_active: true })
  })
})

describe('loadSettings hooks and trust', () => {
  const project = () => {
    const d = dir()
    require('node:fs').mkdirSync(join(d, '.mca'))
    writeFileSync(join(d, '.mca', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }] } }))
    return d
  }
  it('an untrusted workspace ignores project hooks and lists them for the trust prompt', async () => {
    const s = await loadSettings(project(), { trusted: false, home: dir() })
    expect(s.hooks).toEqual({})
    expect(s.ignoredHooks).toEqual(['PreToolUse[Bash]: check.sh'])
  })
  it('a trusted workspace applies them', async () => {
    const s = await loadSettings(project(), { trusted: true, home: dir() })
    expect(s.hooks.PreToolUse).toHaveLength(1)
    expect(s.ignoredHooks).toEqual([])
  })
  it('user hooks always apply', async () => {
    const home = dir()
    require('node:fs').mkdirSync(join(home, '.mca'))
    writeFileSync(join(home, '.mca', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'u.sh' }] }] } }))
    expect((await loadSettings(dir(), { trusted: false, home })).hooks.Stop).toHaveLength(1)
  })
})
