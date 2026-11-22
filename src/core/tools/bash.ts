import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { exec } from '../exec'
import { loginEnv } from '../env'
import { isReadOnlyCommand } from '../permissions'
import { rtkRewrite } from '../rtk'
import { envPath, getShell, shellArgs, shellName } from '../shell'
import type { Tool } from '../tool'

const DEFAULT_TIMEOUT = 120_000
const MAX_TIMEOUT = 600_000

const schema = z.object({
  command: z.string().describe('The bash command to run'),
  timeout: z.number().int().min(1).optional().describe('Timeout in milliseconds (default 120000, max 600000)')
})

export const Bash: Tool<z.infer<typeof schema>> = {
  name: 'Bash',
  description:
    `Run a ${shellName()} command. Only the working directory persists between calls (cd works); environment variables do not. ` +
    'stdin is closed and git/pagers are non-interactive. Default timeout 120s, max 600s; on timeout the command is killed and partial output returned. ' +
    'Do not start long-running servers in the foreground. Prefer Read, Glob, Grep and Edit over cat, find, grep and sed.' +
    (getShell().kind === 'powershell' ? ' This machine has no bash: write PowerShell, not POSIX shell.' : ''),
  schema,
  readOnly: (input) => getShell().kind === 'bash' && isReadOnlyCommand(input.command),
  async run({ command, timeout }, ctx) {
    let notice = ''
    let cwd = ctx.cwd
    if (!existsSync(cwd)) {
      notice = `(The previous working directory no longer exists; reset to ${ctx.root}.)\n`
      ctx.setCwd((cwd = ctx.root))
    }
    const ms = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const cwdFile = join(tmpdir(), `mca-cwd-${randomUUID()}`)
    const env = { ...(await loginEnv()), MCA_CWD_FILE: envPath(cwdFile), GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', GIT_PAGER: 'cat' }
    const shell = getShell()
    const run = shell.kind === 'bash' ? await rtkRewrite(command, { cwd, env, signal: ctx.signal }) : command // the permission check already ran on `command`
    const r = await exec(shell.path, shellArgs(shell, run), { cwd, signal: ctx.signal, timeoutMs: ms, merge: true, env })
    let next: string
    try {
      next = (await readFile(cwdFile, 'utf8').catch(() => '')).trim()
    } finally {
      await rm(cwdFile, { force: true })
    }
    if (next && existsSync(next)) ctx.setCwd(next)
    let out = notice + r.stdout
    if (r.timedOut) out += `\n[Command timed out after ${ms / 1000}s and was killed. Output above is partial.]`
    else if (r.aborted) out += '\n[Command was interrupted.]'
    else if (r.signal) out += `\nTerminated by signal ${r.signal}`
    else if (r.code !== 0) out += `\nExit code ${r.code}`
    return out
  }
}
