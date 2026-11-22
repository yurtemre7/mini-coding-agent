import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { exec } from './exec'
import { parseEnv0 } from './env'
import { getShell } from './shell'

const sh = (script: string, o: Partial<Parameters<typeof exec>[2]> = {}) => exec(getShell().path, ['-c', script], { cwd: tmpdir(), ...o })

describe('exec', () => {
  it('captures output and exit code, strips ANSI', async () => {
    const r = await sh('printf "\\033[31mred\\033[0m"; echo err >&2; exit 3')
    expect(r).toMatchObject({ stdout: 'red', stderr: 'err\n', code: 3, timedOut: false })
  })
  it('bounds output keeping head and tail', async () => {
    const r = await sh('printf "%0.sa" $(seq 5000); printf "%0.sz" $(seq 5000)', { maxChars: 100 })
    expect(r.stdout.startsWith('a'.repeat(50))).toBe(true)
    expect(r.stdout.endsWith('z'.repeat(50))).toBe(true)
    expect(r.stdout.length).toBeLessThan(200)
  })
  it('kills the process group on timeout and returns partial output', async () => {
    const r = await sh('echo start; sleep 30', { timeoutMs: 300 })
    expect(r.timedOut).toBe(true)
    expect(r.stdout).toContain('start')
  })
  it('does not hang on a backgrounded child holding the pipe', async () => {
    const t = Date.now()
    const r = await sh('(sleep 3 &) ; echo done')
    expect(r.stdout).toBe('done\n')
    expect(Date.now() - t).toBeLessThan(2000)
  })
  it('stops on abort', async () => {
    const c = new AbortController()
    setTimeout(() => c.abort(), 100)
    expect((await sh('sleep 30', { signal: c.signal })).aborted).toBe(true)
  })
})

it('parseEnv0 splits NUL-separated entries, keeping "=" in values', () => {
  expect(parseEnv0('A=1\0PATH=/a:/b\0X=a=b\0')).toEqual({ A: '1', PATH: '/a:/b', X: 'a=b' })
})
