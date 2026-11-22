import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from './exec'

const MAX_FILES = 5000
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', '.next', '.cache', 'coverage', '__pycache__', '.venv'])

/** Workspace-relative file paths for `@` mentions: tracked and untracked-but-not-ignored files in a git repo, a bounded directory walk otherwise. */
export async function listWorkspaceFiles(cwd: string): Promise<string[]> {
  const r = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd, timeoutMs: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxChars: 2_000_000 }).catch(() => null)
  if (r && r.code === 0) return r.stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)
  const out: string[] = []
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 6 || out.length >= MAX_FILES) return
    const entries = await readdir(join(cwd, rel || '.'), { withFileTypes: true }).catch(() => [])
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return
      if (e.isSymbolicLink() || (e.name.startsWith('.') && e.isDirectory()) || SKIP.has(e.name)) continue
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(dir, p, depth + 1)
      else if (e.isFile()) out.push(p)
    }
  }
  await walk(cwd, '', 0)
  return out
}
