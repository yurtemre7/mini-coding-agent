import { readFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Decision, PermissionMode } from '../shared/types'
import { FileState } from './filestate'
import { createPermissions, isReadOnlyCommand, parseCommand, Permissions, splitRules } from './permissions'
import { loadSettings } from './settings'
import { isTrusted, trustWorkspace } from './trust'
import { Bash } from './tools/bash'
import { Edit, Read, Write } from './tools/files'
import { Glob, Grep } from './tools/search'
import type { ToolContext } from './tool'

const root = mkdtempSync(join(tmpdir(), 'mca-perm-'))
const tmp = () => mkdtempSync(join(tmpdir(), 'mca-perm-'))
const ctxFor = (ask: ToolContext['ask'] = async () => ({ allow: false })): ToolContext => ({ cwd: root, root, files: new FileState(), setCwd() {}, signal: new AbortController().signal, ask })
type Outcome = 'allow' | 'deny' | 'prompt'

/** Runs decide() with a recording ask(); 'prompt' means the user was asked (and said no). */
async function outcome(p: Permissions, tool: any, input: unknown): Promise<Outcome> {
  let asked = false
  const r = await p.decide(tool, input, ctxFor(async () => ((asked = true), { allow: false })))
  return asked ? 'prompt' : r === undefined ? 'allow' : 'deny'
}
const mk = (mode: PermissionMode, rules: any = {}) => new Permissions({ mode, rules, canAsk: true })

const inside = join(root, 'a.txt')
const outside = join(tmp(), 'b.txt')
const protectedFile = join(root, '.git', 'config')
const cases: [string, PermissionMode, any, unknown, any, Outcome][] = [
  // [label, mode, rules, tool, input, expected]
  ['read inside, default', 'default', {}, Read, { file_path: inside }, 'allow'],
  ['read outside, default', 'default', {}, Read, { file_path: outside }, 'prompt'],
  ['read outside, bypass', 'bypassPermissions', {}, Read, { file_path: outside }, 'allow'],
  ['grep default', 'default', {}, Grep, { pattern: 'x' }, 'allow'],
  ['glob outside', 'default', {}, Glob, { pattern: '*', path: tmpdir() }, 'prompt'],
  ['write inside, default', 'default', {}, Write, { file_path: inside, content: '' }, 'prompt'],
  ['write inside, acceptEdits', 'acceptEdits', {}, Write, { file_path: inside, content: '' }, 'allow'],
  ['edit inside, acceptEdits', 'acceptEdits', {}, Edit, { file_path: inside }, 'allow'],
  ['write outside, acceptEdits', 'acceptEdits', {}, Write, { file_path: outside, content: '' }, 'prompt'],
  ['write inside, plan', 'plan', {}, Write, { file_path: inside, content: '' }, 'deny'],
  ['write inside, plan + allow rule', 'plan', { allow: ['Write'] }, Write, { file_path: inside, content: '' }, 'deny'],
  ['read inside, plan', 'plan', {}, Read, { file_path: inside }, 'allow'],
  ['write inside, bypass', 'bypassPermissions', {}, Write, { file_path: inside, content: '' }, 'allow'],
  ['write inside, allow rule', 'default', { allow: ['Write'] }, Write, { file_path: inside, content: '' }, 'allow'],
  ['write outside, allow Edit(workspace glob) does not cover it', 'default', { allow: [`Edit(${root}/**)`] }, Write, { file_path: outside, content: '' }, 'prompt'],
  ['write inside, Edit(glob) allows Write', 'default', { allow: ['Edit(src/**)'] }, Write, { file_path: join(root, 'src/x.ts'), content: '' }, 'allow'],
  ['write inside, Edit(glob) other dir', 'default', { allow: ['Edit(src/**)'] }, Write, { file_path: join(root, 'lib/x.ts'), content: '' }, 'prompt'],
  ['deny beats allow', 'default', { allow: ['Write'], deny: ['Write'] }, Write, { file_path: inside, content: '' }, 'deny'],
  ['deny beats bypass', 'bypassPermissions', { deny: ['Edit(**/*.secret)'] }, Write, { file_path: join(root, 'k.secret'), content: '' }, 'deny'],
  ['ask rule beats acceptEdits', 'acceptEdits', { ask: ['Edit(src/**)'] }, Edit, { file_path: join(root, 'src/x.ts') }, 'prompt'],
  ['ask rule beats bypass (order: 3 before 4)', 'bypassPermissions', { ask: ['Edit(src/**)'] }, Edit, { file_path: join(root, 'src/x.ts') }, 'prompt'],
  ['protected path, acceptEdits', 'acceptEdits', { allow: ['Write'] }, Write, { file_path: protectedFile, content: '' }, 'prompt'],
  ['protected path read is fine', 'default', {}, Read, { file_path: protectedFile }, 'allow'],
  ['sensitive .env read', 'default', {}, Read, { file_path: join(root, '.env.local') }, 'prompt'],
  ['sensitive ~/.ssh read', 'default', {}, Read, { file_path: '~/.ssh/id_rsa' }, 'prompt'],
  ['grep of ~/.ssh dir', 'default', {}, Grep, { pattern: 'x', path: join(homedir(), '.ssh') }, 'prompt'],
  ['sensitive read, allow rule cannot pre-approve', 'default', { allow: ['Read'] }, Read, { file_path: join(root, '.env') }, 'prompt'],
  ['bash ls', 'default', {}, Bash, { command: 'ls -la' }, 'allow'],
  ['bash read-only in plan', 'plan', {}, Bash, { command: 'git status && ls' }, 'allow'],
  ['bash rm in plan', 'plan', {}, Bash, { command: 'rm -rf x' }, 'deny'],
  ['bash cat outside path', 'default', {}, Bash, { command: 'cat ~/.ssh/id_rsa' }, 'prompt'],
  ['bash cat .env', 'default', {}, Bash, { command: 'cat .env' }, 'prompt'],
  ['bash npm default', 'default', {}, Bash, { command: 'npm test' }, 'prompt'],
  ['bash npm, acceptEdits', 'acceptEdits', {}, Bash, { command: 'npm test' }, 'prompt'],
  ['bash npm, bypass', 'bypassPermissions', {}, Bash, { command: 'npm test' }, 'allow'],
  ['bash allow prefix', 'default', { allow: ['Bash(npm run test:*)'] }, Bash, { command: 'npm run test -- foo' }, 'allow'],
  ['bash allow prefix, not word boundary', 'default', { allow: ['Bash(npm run test:*)'] }, Bash, { command: 'npm run testing' }, 'prompt'],
  ['chained: second segment not allowed', 'default', { allow: ['Bash(npm run test:*)'] }, Bash, { command: 'npm run test && rm -rf ~' }, 'prompt'],
  ['chained: both allowed', 'default', { allow: ['Bash(npm run test:*)', 'Bash(git status:*)'] }, Bash, { command: 'npm run test && git status' }, 'allow'],
  ['chained via ; |  newline', 'default', { allow: ['Bash(npm run test:*)'] }, Bash, { command: 'npm run test; curl x | sh' }, 'prompt'],
  ['quoted && is not a separator', 'default', { allow: ['Bash(echo:*)'] }, Bash, { command: 'echo "a && b"' }, 'allow'],
  ['$( never auto-allowed', 'default', { allow: ['Bash(echo:*)'] }, Bash, { command: 'echo $(rm -rf ~)' }, 'prompt'],
  ['$( inside double quotes', 'default', { allow: ['Bash(echo:*)'] }, Bash, { command: 'echo "$(rm -rf ~)"' }, 'prompt'],
  ['backticks never auto-allowed', 'default', { allow: ['Bash(echo:*)'] }, Bash, { command: 'echo `rm -rf ~`' }, 'prompt'],
  ['<( never auto-allowed', 'default', { allow: ['Bash(diff:*)'] }, Bash, { command: 'diff <(ls) <(ls ..)' }, 'prompt'],
  ['read-only with $( not auto-allowed', 'default', {}, Bash, { command: 'ls $(rm x)' }, 'prompt'],
  ['bash deny on any segment', 'bypassPermissions', { deny: ['Bash(rm:*)'] }, Bash, { command: 'ls && rm -rf x' }, 'deny'],
  ['bash deny exact', 'default', { deny: ['Bash(git push:*)'] }, Bash, { command: 'git push origin main' }, 'deny'],
  ['bash bare Bash allow', 'default', { allow: ['Bash'] }, Bash, { command: 'make' }, 'allow'],
  ['bash exact-string rule (session style)', 'default', { allow: ['Bash(make && make test)'] }, Bash, { command: 'make && make test' }, 'allow'],
  ['backgrounded read-only is not read-only', 'plan', {}, Bash, { command: 'ls &' }, 'deny'],
  ['protected write in bypass -> allow (ruling)', 'bypassPermissions', {}, Write, { file_path: protectedFile, content: '' }, 'allow'],
  ['explicit ask rule in bypass -> prompt', 'bypassPermissions', { ask: ['Write(**/*.lock)'] }, Write, { file_path: join(root, 'x.lock'), content: '' }, 'prompt'],
  // deny-rule bypass attempts (all under bypassPermissions + deny Bash(rm:*))
  ...['rm\t-rf x', 'echo $(rm x)', 'FOO=1 rm x', '(rm x)', '(rm)', '{ rm x; }', 'rm${IFS}x', "echo $'\\'' ; rm x ; echo $'\\''", 'echo `rm x`', 'eval rm x', 'bash -c "rm x"', '! rm x', 'A=1 B=2 rm x', 'echo "$(rm x)"', 'env rm x', 'xargs rm', 'nice -n5 rm x', 'nohup rm x', 'time rm x', 'command rm x', 'builtin rm x', 'sudo rm x', 'doas rm x', 'timeout 5 rm x', 'watch rm x', 'ls | xargs rm', 'find . -exec rm {} \\;', 'find . -execdir rm {} +', 'find . -ok rm {} \\;'].map(
    (command): [string, PermissionMode, any, unknown, any, Outcome] => [`deny evasion: ${command}`, 'bypassPermissions', { deny: ['Bash(rm:*)'] }, Bash, { command }, 'deny']
  ),
  ['deny does not over-match a different program', 'bypassPermissions', { deny: ['Bash(rm:*)'] }, Bash, { command: 'echo remove' }, 'allow'],
  ['wrapper is never auto-allowed', 'default', { allow: ['Bash(env:*)'] }, Bash, { command: 'env ls' }, 'prompt'],
  ['env-prefix strip lets allow match', 'default', { allow: ['Bash(npm test:*)'] }, Bash, { command: 'CI=1 npm test' }, 'allow'],
  ['allow never applies to opaque commands', 'default', { allow: ['Bash(npm test:*)'] }, Bash, { command: "npm test $'x'" }, 'prompt'],
  ['allow never applies to ${', 'default', { allow: ['Bash(echo:*)'] }, Bash, { command: 'echo ${HOME}' }, 'prompt'],
  ['allow never applies to eval', 'default', { allow: ['Bash(eval:*)'] }, Bash, { command: 'eval ls' }, 'prompt'],
  // read-only auto-allow leaks
  ...['cat $HOME/.ssh/id_rsa', 'cat ~root/.ssh/x', 'cat .e*', 'cat .en[v]', 'cat .en?', 'cat {.env,x}', 'rg --file=/etc/x', 'rg -f/etc/x', 'rg --pre=./x foo', 'rg --hostname-bin=./x foo', 'rg --file /etc/x', 'tree -o out.txt'].map(
    (command): [string, PermissionMode, any, unknown, any, Outcome] => [`read-only leak: ${command}`, 'default', {}, Bash, { command }, 'prompt']
  ),
  ['WebFetch domain rule allows host and subdomain', 'default', { allow: ['WebFetch(domain:example.com)'] }, { name: 'WebFetch', readOnly: true }, { url: 'https://docs.example.com/a' }, 'allow'],
  ['WebFetch domain rule rejects lookalike', 'default', { allow: ['WebFetch(domain:example.com)'] }, { name: 'WebFetch', readOnly: false }, { url: 'https://evilexample.com/a' }, 'prompt'],
  ['WebFetch deny domain', 'bypassPermissions', { deny: ['WebFetch(domain:evil.com)'] }, { name: 'WebFetch', readOnly: false }, { url: 'https://evil.com/' }, 'deny'],
  ['mcp tool allow by exact name', 'default', { allow: ['mcp__srv__do'] }, { name: 'mcp__srv__do', readOnly: false }, {}, 'allow'],
  ['mcp tool other name prompts', 'default', { allow: ['mcp__srv__do'] }, { name: 'mcp__srv__other', readOnly: false }, {}, 'prompt'],
  ['mcp tool deny', 'bypassPermissions', { deny: ['mcp__srv__do'] }, { name: 'mcp__srv__do', readOnly: false }, {}, 'deny']
]

describe('decide() mode x rule x tool matrix', () => {
  it.each(cases)('%s', async (_l, mode, rules, tool, input, expected) => {
    expect(await outcome(mk(mode, rules), tool, input)).toBe(expected)
  })

  it('allow rules need the real path: a symlink inside the workspace cannot borrow Edit(src/**)', async () => {
    const out = tmp()
    mkdirSync(join(root, 'src'), { recursive: true })
    symlinkSync(out, join(root, 'src/link'))
    const target = join(root, 'src/link/x.txt')
    expect(await outcome(mk('default', { allow: ['Edit(src/**)'] }), Write, { file_path: target, content: '' })).toBe('prompt')
    expect(await outcome(mk('default', { allow: ['Edit(src/**)'] }), Write, { file_path: join(root, 'src/ok.txt'), content: '' })).toBe('allow')
    expect(await outcome(mk('bypassPermissions', { deny: ['Edit(src/**)'] }), Write, { file_path: target, content: '' })).toBe('deny') // deny keeps lexical match
  })

  it('plan-mode denial names ExitPlanMode', async () => {
    expect(await mk('plan').decide(Write, { file_path: inside, content: '' }, ctxFor())).toContain('ExitPlanMode')
  })
})

describe('isReadOnlyCommand', () => {
  it.each([
    ['ls -la', true],
    ['git status', true],
    ['git log --oneline | head -5', true],
    ['git diff HEAD~1 && git show', true],
    ['git branch', true],
    ['git branch -a', true],
    ['rg foo src | wc -l', true],
    ['echo "a; b"', true],
    ['git branch -D feature', false],
    ['git branch new-branch', false],
    ['git diff --output=x.patch', false],
    ['git push', false],
    ['rg --pre ./evil x', false],
    ['ls > out.txt', false],
    ['cat < in.txt', false],
    ['ls &', false],
    ['ls & rm x', false],
    ['ls $(pwd)', false],
    ['ls `pwd`', false],
    ['cat <(ls)', false],
    ['echo "unterminated', false],
    ['find . -delete', false],
    ['sed -i s/a/b/ f', false],
    ['rm x', false],
    ['ls && rm x', false],
    ['', false]
  ])('%s -> %s', (cmd, expected) => expect(isReadOnlyCommand(cmd)).toBe(expected))

  it('Bash.readOnly uses it', () => {
    expect((Bash.readOnly as (i: any) => boolean)({ command: 'ls' })).toBe(true)
    expect((Bash.readOnly as (i: any) => boolean)({ command: 'rm x' })).toBe(false)
  })

  it('splitter is quote-aware and keeps redirections like 2>&1 in one segment', () => {
    expect(parseCommand(`a && b || c; d | e\nf`).segments).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(parseCommand(`echo 'x && y' "p | q"`).segments).toEqual([`echo 'x && y' "p | q"`])
    const p = parseCommand('make 2>&1 | tee log')
    expect(p.segments).toEqual(['make 2>&1', 'tee log'])
    expect(p.background).toBe(false)
  })

  it('splitRules keeps parenthesised rules whole', () => {
    expect(splitRules(['Bash(npm run test:*) Edit,Read', 'Bash(git status:*)'])).toEqual(['Bash(npm run test:*)', 'Edit', 'Read', 'Bash(git status:*)'])
  })
})

describe('prompting', () => {
  it('headless (no prompt available) denies naming both flags', async () => {
    const p = new Permissions({ mode: 'default', canAsk: false })
    const r = await p.decide(Bash, { command: 'npm test' }, ctxFor())
    expect(r).toContain('--permission-mode')
    expect(r).toContain('--allowed-tools')
  })

  it('an aborted queued prompt reports Aborted, not a user decline', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await mk('default').decide(Bash, { command: 'a1' }, { ...ctxFor(), signal: ac.signal })).toBe('Aborted.')
  })

  it('session prefix with a quote falls back to the exact string', async () => {
    const p = mk('default')
    await p.decide(Bash, { command: `git "commit" -m x` }, ctxFor(async () => ({ allow: true, scope: 'session' })))
    expect(p.session).toEqual([`Bash(git "commit" -m x)`])
  })

  it('denial feedback is returned to the model', async () => {
    const r = await mk('default').decide(Write, { file_path: inside, content: '' }, ctxFor(async () => ({ allow: false, feedback: 'use Edit instead' })))
    expect(r).toContain('use Edit instead')
  })

  it('"Yes for this session" stores the narrowest rule', async () => {
    const yes: Decision = { allow: true, scope: 'session' }
    const once = async () => ({ allow: true, scope: 'once' as const })
    const ask = async () => yes
    // simple Bash command: first two words as prefix
    let p = mk('default')
    await p.decide(Bash, { command: 'npm run build --prod' }, ctxFor(ask))
    expect(p.session).toEqual(['Bash(npm run:*)'])
    expect(await outcome(p, Bash, { command: 'npm run lint' })).toBe('allow')
    expect(await outcome(p, Bash, { command: 'npm install' })).toBe('prompt')
    expect(await outcome(p, Bash, { command: 'npm run lint && rm -rf ~' })).toBe('prompt')
    // compound: exact string only
    p = mk('default')
    await p.decide(Bash, { command: 'make && make test' }, ctxFor(ask))
    expect(p.session).toEqual(['Bash(make && make test)'])
    expect(await outcome(p, Bash, { command: 'make' })).toBe('prompt')
    expect(await outcome(p, Bash, { command: 'make && make test' })).toBe('allow')
    // Edit/Write: workspace only, and protected paths still prompt
    p = mk('default')
    await p.decide(Write, { file_path: inside, content: '' }, ctxFor(ask))
    expect(await outcome(p, Edit, { file_path: join(root, 'deep/x.ts') })).toBe('allow')
    expect(await outcome(p, Write, { file_path: outside, content: '' })).toBe('prompt')
    expect(await outcome(p, Write, { file_path: protectedFile, content: '' })).toBe('prompt')
    // once stores nothing
    p = mk('default')
    await p.decide(Bash, { command: 'npm test' }, ctxFor(once))
    expect(p.session).toEqual([])
    // $( commands store nothing
    p = mk('default')
    await p.decide(Bash, { command: 'echo $(ls)' }, ctxFor(ask))
    expect(p.session).toEqual([])
  })

  it('prompts are serialized: parallel calls never overlap', async () => {
    const p = mk('default')
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const ask: ToolContext['ask'] = async (req: any) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(req.input.command)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return { allow: true }
    }
    await Promise.all(['a1', 'b1', 'c1'].map((command) => p.decide(Bash, { command }, ctxFor(ask))))
    expect(maxActive).toBe(1)
    expect(order).toEqual(['a1', 'b1', 'c1'])
  })

  it('a queued prompt whose turn was aborted is never shown', async () => {
    const p = mk('default')
    const ac = new AbortController()
    const slow = ctxFor(() => new Promise<Decision>((r) => setTimeout(() => r({ allow: true }), 20)))
    let shown = 0
    const queued = { ...ctxFor(async () => (shown++, { allow: true })), signal: ac.signal }
    const first = p.decide(Bash, { command: 'a1' }, slow)
    const second = p.decide(Bash, { command: 'b1' }, queued)
    ac.abort()
    await first
    expect(await second).toBe('Aborted.')
    expect(shown).toBe(0)
  })
})

describe('settings and trust', () => {
  const setup = () => {
    const home = tmp()
    const ws = tmp()
    mkdirSync(join(home, '.mca'))
    mkdirSync(join(ws, '.mca'))
    mkdirSync(join(ws, '.claude'))
    writeFileSync(join(home, '.mca/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(sudo:*)'], defaultMode: 'acceptEdits' }, model: 'x' }))
    writeFileSync(join(ws, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(claude:*)'], defaultMode: 'plan' } }))
    writeFileSync(join(ws, '.mca/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm run test:*)'], deny: ['Bash(rm:*)'], ask: ['Read(secret/**)'], defaultMode: 'default' } }))
    writeFileSync(join(ws, '.mca/settings.local.json'), '{ not json')
    return { home, ws }
  }

  it('merges layers; .mca beats .claude; project beats user; bad JSON is a warning', async () => {
    const { home, ws } = setup()
    const s = await loadSettings(ws, { trusted: true, home })
    expect(s.permissions.allow).toEqual(['Bash(ls:*)', 'Bash(claude:*)', 'Bash(npm run test:*)'])
    expect(s.permissions.deny).toEqual(['Bash(sudo:*)', 'Bash(rm:*)'])
    expect(s.permissions.ask).toEqual(['Read(secret/**)'])
    expect(s.defaultMode).toBe('default')
    expect(s.rest.model).toBe('x')
    expect(s.warnings[0]).toContain('settings.local.json')
  })

  it('untrusted: project allow rules and defaultMode ignored; user rules, deny and ask still apply', async () => {
    const { home, ws } = setup()
    const s = await loadSettings(ws, { trusted: false, home })
    expect(s.permissions.allow).toEqual(['Bash(ls:*)'])
    expect(s.permissions.deny).toEqual(['Bash(sudo:*)', 'Bash(rm:*)'])
    expect(s.permissions.ask).toEqual(['Read(secret/**)'])
    expect(s.defaultMode).toBe('acceptEdits')
    expect(s.projectAllow).toEqual(['Bash(claude:*)', 'Bash(npm run test:*)'])
  })

  it('trust gates project allow rules end to end, and is recorded in state.json', async () => {
    const { home, ws } = setup()
    const run = async (trusted: boolean) => {
      const { perms } = await createPermissions({ cwd: ws, trusted, canAsk: false, home })
      const c = { ...ctxFor(), cwd: ws, root: ws }
      return perms.decide(Bash, { command: 'npm run test' }, c)
    }
    expect(await run(false)).toContain('--allowed-tools')
    expect(await run(true)).toBeUndefined()
    expect(await isTrusted(ws, home)).toBe(false)
    await trustWorkspace(ws, home)
    expect(await isTrusted(ws, home)).toBe(true)
  })

  it('untrusted project keys do not pass through; trusted ones do', async () => {
    const { home, ws } = setup()
    writeFileSync(join(ws, '.mca/settings.json'), JSON.stringify({ hooks: { x: 1 } }))
    expect((await loadSettings(ws, { trusted: false, home })).rest).toEqual({ model: 'x' })
    expect((await loadSettings(ws, { trusted: true, home })).rest).toEqual({ model: 'x', hooks: { x: 1 } })
  })

  it('corrupt state.json is kept: trust is refused, not overwritten', async () => {
    const { home, ws } = setup()
    writeFileSync(join(home, '.mca/state.json'), '{ broken')
    await expect(trustWorkspace(ws, home)).rejects.toThrow(/corrupt/)
    expect(readFileSync(join(home, '.mca/state.json'), 'utf8')).toBe('{ broken')
    expect(await isTrusted(ws, home)).toBe(false)
  })

  it('--allowed-tools rules are session allow rules', async () => {
    const { home, ws } = setup()
    const { perms } = await createPermissions({ cwd: ws, trusted: false, canAsk: false, home, allowedTools: ['Bash(make:*) Write'] })
    expect(perms.rules.allow).toContain('Bash(make:*)')
    expect(perms.rules.allow).toContain('Write')
  })
})
