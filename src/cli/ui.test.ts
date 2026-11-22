import { describe, expect, it } from 'vitest'
import { CtrlC, formatPermission, parseChoice, terminalFrontend } from './ui'

const term = (answers: string[]) => {
  const t = { out: '', asked: [] as string[], color: false, write: (s: string) => void (t.out += s), readLine: async (q: string) => (t.asked.push(q), answers.shift() ?? Promise.reject(new Error('closed'))) }
  return t
}
const req = { kind: 'permission' as const, toolName: 'Bash', input: { command: 'npm test' }, reason: 'x', suggestion: 'Bash(npm test:*)' }

describe('permission prompt', () => {
  it('formats the numbered options with the session rule', () => {
    const s = formatPermission(req)
    expect(s).toContain('Bash: npm test')
    expect(s).toContain('1. Yes')
    expect(s).toContain('2. Yes, for this session (Bash(npm test:*))')
    expect(s).toContain('3. No')
  })
  it('a dangerous command is flagged and offers no session rule', () => {
    const s = formatPermission({ ...req, input: { command: 'rm -rf /' }, danger: true, suggestion: undefined })
    expect(s).toContain('WARNING')
    expect(s).toContain('1. Yes, run it anyway')
    expect(s).toContain('not remembered')
  })
  it('parseChoice never guesses', () => {
    expect(parseChoice('1')).toEqual({ allow: true, scope: 'once' })
    expect(parseChoice(' 2 ')).toEqual({ allow: true, scope: 'session' })
    expect(parseChoice('3')).toEqual({ allow: false })
    expect(parseChoice('maybe')).toBeUndefined()
  })
  it('ask(): reprompts on garbage, 2 = session, 3 asks for feedback', async () => {
    expect(await terminalFrontend(term(['??', '2'])).ask(req)).toEqual({ allow: true, scope: 'session' })
    expect(await terminalFrontend(term(['3', 'use Edit'])).ask(req)).toEqual({ allow: false, feedback: 'use Edit' })
    expect(await terminalFrontend(term(['3', ''])).ask(req)).toEqual({ allow: false })
  })
  it('ask(): invalid answer says what to enter', async () => {
    const t = term(['x', '1'])
    await terminalFrontend(t).ask(req)
    expect(t.out).toContain('Enter 1, 2 or 3.')
  })
  it('ask(): closed input is a denial', async () => {
    expect(await terminalFrontend(term([])).ask(req)).toMatchObject({ allow: false })
  })
  it('trust request lists the rules', async () => {
    const t = term(['y'])
    expect(await terminalFrontend(t).ask({ kind: 'trust', workspace: '/w', rules: ['Bash(ls:*)'] })).toEqual({ allow: true })
    expect(t.out).toContain('Bash(ls:*)')
  })
})

describe('rendering', () => {
  it('streams ⏺ text and ⎿ tool output without colour codes on a non-TTY', () => {
    const t = term([])
    const fe = terminalFrontend(t)
    fe.emit({ type: 'text_delta', text: 'Hel' })
    fe.emit({ type: 'text_delta', text: 'lo' })
    fe.emit({ type: 'tool_start', id: '1', name: 'Read', input: { file_path: 'a.ts' } })
    fe.emit({ type: 'tool_end', id: '1', result: 'l1\nl2\nl3\nl4\nl5\nl6', isError: false })
    expect(t.out).toBe('⏺ Hello\n⏺ Read(a.ts)\n  ⎿ l1\n    l2\n    l3\n    l4\n    … +2 lines\n')
  })
})

describe('Ctrl+C state', () => {
  const idle = { busy: false, hasInput: false }
  it('aborts a running turn', () => expect(new CtrlC().press({ busy: true, hasInput: false })).toBe('abort'))
  it('second press within 2 s at an empty prompt exits; later one only warns', () => {
    const c = new CtrlC()
    expect(c.press(idle, 1000)).toBe('warn')
    expect(c.press(idle, 2500)).toBe('exit')
    const d = new CtrlC()
    expect(d.press(idle, 1000)).toBe('warn')
    expect(d.press(idle, 3500)).toBe('warn')
  })
  it('typed text is cleared instead, and an abort resets the window', () => {
    const c = new CtrlC()
    c.press(idle, 1000)
    expect(c.press({ busy: false, hasInput: true }, 1500)).toBe('clear')
    expect(c.press(idle, 1600)).toBe('warn')
  })
})

describe('runInteractive demo (piped streams)', () => {
  it('prompts before an edit, "Yes for this session" stops the next prompt, /rewind restores', async () => {
    const { PassThrough } = await import('node:stream')
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { FakeProvider } = await import('../core/provider/fake')
    const { runInteractive } = await import('./ui')
    const dir = mkdtempSync(join(tmpdir(), 'mca-repl-'))
    const home = mkdtempSync(join(tmpdir(), 'mca-home-'))
    writeFileSync(join(dir, 'a.txt'), 'orig')
    const write = (id: string, content: string) => [{ type: 'tool_use' as const, id, name: 'Write', input: { file_path: join(dir, 'a.txt'), content } }, { type: 'stop' as const, reason: 'tool_use' as const }]
    const end = [{ type: 'stop' as const, reason: 'end_turn' as const }]
    const read = [{ type: 'tool_use' as const, id: 'r', name: 'Read', input: { file_path: join(dir, 'a.txt') } }, { type: 'stop' as const, reason: 'tool_use' as const }]
    const provider = new FakeProvider([read, write('1', 'v1'), end, write('2', 'v2'), end])
    const input = new PassThrough()
    const output = new PassThrough()
    let out = ''
    output.on('data', (d) => (out += d))
    const done = runInteractive({ provider, model: 'm', cwd: dir, input, output, home })
    let seen = 0 // everything before `seen` was already handled
    const waiters: (() => void)[] = []
    output.on('data', () => waiters.splice(0).forEach((w) => w()))
    // wait until `marker` was printed AND the output ends with a fresh "> " prompt, so input is never typed ahead of a question
    const reply = async (marker: string, line: string) => {
      while (!(out.slice(seen).includes(marker) && out.endsWith('> '))) await new Promise<void>((r) => waiters.push(r))
      seen = out.length
      input.write(line + '\n')
    }
    await reply('/help for commands', 'change it')
    await reply('2. Yes, for this session', '2')
    await reply('Overwrote', 'again') // turn 1 done; the second write must not prompt
    await reply('Overwrote', '/rewind')
    await reply('Restored: a.txt', '/exit')
    await done
    expect(out.match(/Do you want to proceed/g)).toHaveLength(1)
    expect(out).toContain('Restored: a.txt')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('v1')
  })
})
