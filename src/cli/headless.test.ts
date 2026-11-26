import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../core/provider/fake'
import { plainFrontend, runHeadless } from './headless'

const io = () => {
  const o = { out: '', err: '' }
  return { o, io: { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s) } }
}

describe('headless', () => {
  it('passes the effort on every stream call', async () => {
    const { io: i } = io()
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'package.json' } }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'stop', reason: 'end_turn' }]
    ])
    await runHeadless({ prompt: 'p', provider, model: 'm', effort: 'high', cwd: process.cwd(), io: i })
    expect(provider.requests.map((r) => r.effort)).toEqual(['high', 'high'])
  })
  it('answer to stdout, tool activity to stderr, exit 0', async () => {
    const { o, io: i } = io()
    const provider = new FakeProvider([
      [{ type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'package.json' } }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'version is 0.1.0' }, { type: 'stop', reason: 'end_turn' }]
    ])
    expect(await runHeadless({ prompt: 'p', provider, model: 'm', cwd: process.cwd(), io: i })).toBe(0)
    expect(o.out).toBe('version is 0.1.0\n')
    expect(o.err).toContain('⏺ Read(')
    expect(o.err).toContain('⎿')
  })

  it('exit 1 on a runtime error, message on stderr', async () => {
    const { o, io: i } = io()
    const provider = new FakeProvider([[]]) // no stop event, then script exhausted on the retry-free second call
    provider.stream = () =>
      (async function* () {
        yield* [] // a stream that yields nothing, then fails
        throw new Error('down')
      })()
    expect(await runHeadless({ prompt: 'p', provider, model: 'm', cwd: '/', io: i })).toBe(1)
    expect(o.err).toContain('error: down')
  })

  it('--trace writes full tool inputs, errors by call id and a usage total', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-trace-'))
    const trace = join(dir, 'trace.jsonl')
    const long = 'x'.repeat(500)
    const provider = new FakeProvider([
      [
        { type: 'tool_use', id: 'a', name: 'Bash', input: { command: `mca-no-such-command ${long}` } },
        { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: 'package.json' } },
        { type: 'usage', contextTokens: 1000, outputTokens: 50, costUsd: 0.01 },
        { type: 'stop', reason: 'tool_use' }
      ],
      [{ type: 'usage', contextTokens: 1200, outputTokens: 20, costUsd: 0.02 }, { type: 'text_delta', text: 'ok' }, { type: 'stop', reason: 'end_turn' }]
    ])
    const { o, io: i } = io()
    expect(await runHeadless({ prompt: 'p', provider, model: 'm', cwd: process.cwd(), io: i, home: dir, trace })).toBe(0)
    const lines = readFileSync(trace, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const starts = lines.filter((l) => l.type === 'tool_start')
    expect(starts.map((l) => [l.id, l.name])).toEqual([['a', 'Bash'], ['b', 'Read']])
    expect(starts[0].input.command).toBe(`mca-no-such-command ${long}`) // not cut at 200 characters like stderr
    expect(o.err).not.toContain(long)
    const ends = Object.fromEntries(lines.filter((l) => l.type === 'tool_end').map((l) => [l.id, l.isError]))
    expect(ends).toEqual({ a: true, b: false }) // an unapproved command is denied headless; the error belongs to call a, not the last call
    expect(lines.find((l) => l.type === 'usage')).toMatchObject({ inputTokens: 2200, outputTokens: 70, requests: 2, costPartial: false })
    expect(lines.find((l) => l.type === 'usage').costUsd).toBeCloseTo(0.03)
    expect(lines.at(-1)).toEqual({ type: 'end', reason: 'done' })
  })

  it('--trace reports an unknown cost as null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-trace-'))
    const trace = join(dir, 'trace.jsonl')
    const provider = new FakeProvider([[{ type: 'usage', contextTokens: 10, outputTokens: 1 }, { type: 'text_delta', text: 'ok' }, { type: 'stop', reason: 'end_turn' }]])
    await runHeadless({ prompt: 'p', provider, model: 'no-price-model', cwd: process.cwd(), io: io().io, home: dir, trace })
    const usage = readFileSync(trace, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.type === 'usage')
    expect(usage).toMatchObject({ requests: 1, costPartial: true, costUsd: null })
  })

  it('plain frontend ask() denies', async () => {
    expect(await plainFrontend(io().io).ask({ kind: 'plan', plan: 'x' })).toMatchObject({ allow: false })
  })
})

describe('permission mode', () => {
  const writeCall = (file: string) => [
    [{ type: 'tool_use' as const, id: '1', name: 'Write', input: { file_path: file, content: 'x' } }, { type: 'stop' as const, reason: 'tool_use' as const }],
    [{ type: 'stop' as const, reason: 'end_turn' as const }]
  ]
  it('default denies Write naming --permission-mode; bypassPermissions allows it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-perm-'))
    const a = io()
    await runHeadless({ prompt: 'p', provider: new FakeProvider(writeCall('a.txt')), model: 'm', cwd: dir, io: a.io, home: dir })
    expect(a.o.err).toContain('--permission-mode')
    expect(a.o.err).toContain('--allowed-tools')
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    const b = io()
    await runHeadless({ prompt: 'p', provider: new FakeProvider(writeCall('a.txt')), model: 'm', cwd: dir, io: b.io, home: dir, permissionMode: 'bypassPermissions' })
    expect(existsSync(join(dir, 'a.txt'))).toBe(true)
  })

  it('acceptEdits allows an inside write; --allowed-tools allows it in default mode', async () => {
    for (const o of [{ permissionMode: 'acceptEdits' as const }, { allowedTools: ['Write'] }]) {
      const dir = mkdtempSync(join(tmpdir(), 'mca-perm-'))
      await runHeadless({ prompt: 'p', provider: new FakeProvider(writeCall('a.txt')), model: 'm', cwd: dir, io: io().io, home: dir, ...o })
      expect(existsSync(join(dir, 'a.txt'))).toBe(true)
    }
  })

  it('project allow rules apply only with trust', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mca-perm-'))
    mkdirSync(join(dir, '.mca'))
    writeFileSync(join(dir, '.mca/settings.json'), JSON.stringify({ permissions: { allow: ['Write'] } }))
    const a = io()
    await runHeadless({ prompt: 'p', provider: new FakeProvider(writeCall('a.txt')), model: 'm', cwd: dir, io: a.io, home: mkdtempSync(join(tmpdir(), 'mca-home-')) })
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    expect(a.o.err).toContain('not trusted')
    await runHeadless({ prompt: 'p', provider: new FakeProvider(writeCall('a.txt')), model: 'm', cwd: dir, io: io().io, home: mkdtempSync(join(tmpdir(), 'mca-home-')), trust: true })
    expect(existsSync(join(dir, 'a.txt'))).toBe(true)
  })
})
