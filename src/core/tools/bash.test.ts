import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Bash } from './bash'
import { testCtx } from './testutil'

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
  it('cd persists across calls, even with exit 3', async () => {
    const { dir, ctx } = mk()
    mkdirSync(join(dir, 'sub'))
    await run(ctx, 'cd sub; exit 3')
    expect(ctx.cwd).toBe(join(dir, 'sub'))
    expect(await run(ctx, 'pwd')).toBe(join(dir, 'sub') + '\n')
  })
  it('output cannot forge the cwd; env vars do not persist', async () => {
    const { dir, ctx } = mk()
    await run(ctx, 'FOO=1; echo /etc')
    expect(ctx.cwd).toBe(dir)
    expect(await run(ctx, 'echo "[$FOO]"')).toBe('[]\n')
  })
  it('resets to the workspace root, with a notice, when the stored cwd was deleted', async () => {
    const { dir, ctx } = mk()
    mkdirSync(join(dir, 'gone'))
    await run(ctx, 'cd gone')
    rmSync(join(dir, 'gone'), { recursive: true })
    const out = await run(ctx, 'pwd')
    expect(out).toContain('no longer exists')
    expect(ctx.cwd).toBe(dir)
  })
  it('keeps the cwd when the trap file is never written (exec)', async () => {
    const { dir, ctx } = mk()
    await run(ctx, 'exec true')
    expect(ctx.cwd).toBe(dir)
  })
  it('timeout kills the whole process group and returns partial output', async () => {
    const { ctx } = mk()
    const out = await run(ctx, 'echo before; (sleep 30 & echo $! > pid; wait)', 500).catch((e) => e)
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
})
