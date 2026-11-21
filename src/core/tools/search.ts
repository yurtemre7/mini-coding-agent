import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { z } from 'zod'
import { exec } from '../exec'
import { loginEnv } from '../env'
import { resolvePath } from '../paths'
import { truncate, type Tool } from '../tool'

/** MCA_RG_PATH, then the bundled binary (unpacked from asar in packaged builds), then `rg` on PATH. */
export function rgBinary(): string {
  if (process.env.MCA_RG_PATH) return process.env.MCA_RG_PATH
  const bundled = rgPath.replace(/app\.asar(?!\.)/, 'app.asar.unpacked')
  return existsSync(bundled) ? bundled : 'rg'
}

async function rg(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  const r = await exec(rgBinary(), args, { cwd, signal, env: await loginEnv(), timeoutMs: 60_000, maxChars: 200_000 })
  if (r.code === 1) return 'No matches.'
  if (r.code !== 0) throw new Error(r.stderr.trim() || (r.timedOut ? 'rg timed out after 60s.' : `rg failed (${r.code}).`))
  return r.stdout.replace(/^\.\//gm, '')
}

async function target(cwd: string, path: string | undefined): Promise<{ dir: string; arg: string }> {
  const p = resolvePath(cwd, path ?? '.')
  const info = await stat(p).catch(() => undefined)
  if (!info) throw new Error(`Path does not exist: ${p}`)
  return info.isDirectory() ? { dir: p, arg: '.' } : { dir: dirname(p), arg: basename(p) }
}

const globSchema = z.object({
  pattern: z.string().describe('Glob pattern such as "**/*.ts" or "src/**/*.test.ts"'),
  path: z.string().optional().describe('Directory to search (default: working directory)')
})

export const Glob: Tool<z.infer<typeof globSchema>> = {
  name: 'Glob',
  description: 'Find files by glob pattern, newest first (max 100). Respects .gitignore. Use it to list a directory or locate files by name.',
  schema: globSchema,
  readOnly: true,
  async run({ pattern, path }, ctx) {
    const t = await target(ctx.cwd, path)
    if (t.arg !== '.') throw new Error(`${resolvePath(ctx.cwd, path!)} is a file, not a directory.`)
    const out = await rg(['--files', '--hidden', '--no-require-git', '-g', pattern, '-g', '!.git', '--sortr', 'modified', '.'], t.dir, ctx.signal)
    if (out === 'No matches.') return out
    const files = out.split('\n').filter(Boolean)
    return files.slice(0, 100).join('\n') + (files.length > 100 ? `\n\n(${files.length - 100} more files omitted; narrow the pattern or path.)` : '')
  }
}

const grepSchema = z.object({
  pattern: z.string().describe('Regular expression (Rust regex syntax)'),
  path: z.string().optional().describe('File or directory to search (default: working directory)'),
  glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts"'),
  output_mode: z.enum(['files_with_matches', 'content']).optional().describe('files_with_matches (default) lists file names; content shows matching lines'),
  ignore_case: z.boolean().optional()
})

export const Grep: Tool<z.infer<typeof grepSchema>> = {
  name: 'Grep',
  description: 'Search file contents with ripgrep. Respects .gitignore. Default output lists matching files; use output_mode "content" for lines (with line numbers).',
  schema: grepSchema,
  readOnly: true,
  async run({ pattern, path, glob, output_mode, ignore_case }, ctx) {
    const t = await target(ctx.cwd, path)
    const content = output_mode === 'content'
    const args = ['--hidden', '--no-require-git', '-g', '!.git', ...(content ? ['-n', '--with-filename', '--no-heading', '--max-columns', '300'] : ['-l']), ...(ignore_case ? ['-i'] : []), ...(glob ? ['-g', glob] : []), '-e', pattern, '--', t.arg]
    return truncate(await rg(args, t.dir, ctx.signal), 20_000)
  }
}
