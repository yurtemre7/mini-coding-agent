import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Bash } from './bash'
import { resetRtk } from '../rtk'
import { testCtx } from './testutil'

// the real login-shell environment is cached for the whole run; these tests change PATH, so read it fresh
vi.mock('../env', () => ({ loginEnv: async () => ({ ...process.env }) }))

/** Same directory, whatever the spelling (C:/ vs C:\\, short vs long names on Windows). */
const same = (a: string, b: string) => expect(realpathSync.native(a)).toBe(realpathSync.native(b))
const mk = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mca-bash-')))
  return { dir, ctx: testCtx(dir) }
}
const run = (ctx: ReturnType<typeof testCtx>, command: string, timeout?: number) => Bash.run({ command, timeout }, ctx)
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('Bash', () => {
  it('runs a command, merges stderr, reports non-zero exit', async () => {
    const { ctx } = mk()
    expect(await run(ctx, 'echo out; echo err >&2')).toContain('out')
    expect(await run(ctx, 'echo hi; exit 3')).toBe('hi\n\nExit code 3')
  })
  it.skipIf(process.platform === 'win32')('reports a signal-killed command', async () => {
    const { ctx } = mk()
    expect(await run(ctx, 'kill -9 $$')).toContain('Terminated by signal SIGKILL')
  })
  it('cd persists across calls, even with exit 3', async () => {
    const { dir, ctx } = mk()
    mkdirSync(join(dir, 'sub'))
    await run(ctx, 'cd sub; exit 3')
    same(ctx.cwd, join(dir, 'sub'))
    if (process.platform !== 'win32') expect(await run(ctx, 'pwd')).toBe(join(dir, 'sub') + '\n')
  })
  it('output cannot forge the cwd; env vars do not persist', async () => {
    const { dir, ctx } = mk()
    await run(ctx, 'FOO=1; echo /etc')
    same(ctx.cwd, dir)
    expect(await run(ctx, 'echo "[$FOO]"')).toBe('[]\n')
  })
  it('resets to the workspace root, with a notice, when the stored cwd was deleted', async () => {
    const { dir, ctx } = mk()
    mkdirSync(join(dir, 'gone'))
    await run(ctx, 'cd gone')
    rmSync(join(dir, 'gone'), { recursive: true })
    const out = await run(ctx, 'pwd')
    expect(out).toContain('no longer exists')
    same(ctx.cwd, dir)
  })
  it('keeps the cwd when the trap file is never written (exec)', async () => {
    const { dir, ctx } = mk()
    await run(ctx, 'exec true')
    same(ctx.cwd, dir)
  })
  it('timeout kills the whole process group and returns partial output', async () => {
    const { ctx } = mk()
    const out = await run(ctx, 'echo before; (sleep 30 & echo $! > pid; wait)', 500)
    expect(out).toContain('before')
    expect(out).toContain('timed out')
    const pid = Number((await run(ctx, 'cat pid')).trim())
    await new Promise((r) => setTimeout(r, 300))
    expect(alive(pid)).toBe(false)
  })
  it('a backgrounded child holding the pipe does not hang the tool', async () => {
    const { ctx } = mk()
    const t = Date.now()
    const out = await run(ctx, 'sleep 30 & echo started')
    expect(out).toContain('started')
    expect(Date.now() - t).toBeLessThan(5000)
  })
  it('strips ANSI and bounds output to head + tail', async () => {
    const { ctx } = mk()
    expect(await run(ctx, "printf '\\033[31mred\\033[0m'")).toBe('red')
    const out = await run(ctx, 'yes abcdefghij | head -c 200000')
    expect(out).toContain('characters truncated')
    expect(out.length).toBeLessThan(31_000)
  })
  it.skipIf(process.platform === 'win32')('runs the RTK form of a command when rtk is on PATH', async () => {
    const { dir, ctx } = mk()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'rtk'), '#!/bin/sh\n[ "$1" = rewrite ] && echo "echo REWRITTEN" && exit 0\nexit 1\n')
    chmodSync(join(bin, 'rtk'), 0o755)
    const old = process.env.PATH
    resetRtk()
    process.env.PATH = `${bin}:${old}`
    try {
      expect(await run(ctx, 'echo original')).toContain('REWRITTEN')
    } finally {
      process.env.PATH = old
      resetRtk()
    }
  })
})
