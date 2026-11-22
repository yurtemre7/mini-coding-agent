import { exec } from './exec'

import type { GitBranches, GitStatus } from '../shared/types'

const TIMEOUT = 30_000
const NET_TIMEOUT = 120_000
const NO_PROMPT = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' } // never wait for a password or a pager

async function git(cwd: string, args: string[], timeoutMs = TIMEOUT): Promise<string> {
  const r = await exec('git', args, { cwd, timeoutMs, env: NO_PROMPT, maxChars: 400_000 })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n') || `git ${args[0]} failed`)
  return r.stdout
}

/** A path from the renderer must stay inside the repo and can never look like an option. */
const safePath = (p: string): string => {
  if (!p || p.startsWith('/') || p.startsWith('-') || p.split(/[\\/]/).includes('..') || p.includes('\0')) throw new Error(`Invalid path: ${p}`)
  return p
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const empty: GitStatus = { repo: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  let out: string
  try {
    out = await git(cwd, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'])
  } catch {
    return empty
  }
  const [head, ...rest] = out.split('\0')
  const s: GitStatus = { ...empty, repo: true }
  const m = /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(head)
  if (m) {
    s.branch = m[1] === 'HEAD (no branch)' ? null : m[1]
    s.upstream = m[2] ?? null
    s.ahead = Number(/ahead (\d+)/.exec(m[3] ?? '')?.[1] ?? 0)
    s.behind = Number(/behind (\d+)/.exec(m[3] ?? '')?.[1] ?? 0)
  }
  for (let i = 0; i < rest.length; i++) {
    const e = rest[i]
    if (e.length < 4) continue
    const [x, y] = [e[0], e[1]]
    s.files.push({ path: e.slice(3), index: x === ' ' || x === '?' ? '' : x, worktree: y === ' ' ? '' : y })
    if (x === 'R' || x === 'C') i++ // the next entry is the original path
  }
  return s
}

/** Unified diff of one file: staged (index vs HEAD) or unstaged (worktree vs index). An untracked file is shown as all added. */
export async function gitDiff(cwd: string, path: string, staged: boolean): Promise<string> {
  const p = safePath(path)
  const st = (await gitStatus(cwd)).files.find((f) => f.path === p)
  if (st?.worktree === '?' && !staged) {
    const r = await exec('git', ['diff', '--no-index', '--', '/dev/null', p], { cwd, timeoutMs: TIMEOUT, env: NO_PROMPT, maxChars: 400_000 })
    return r.stdout // exit code 1 just means "differs"
  }
  return git(cwd, ['diff', ...(staged ? ['--cached'] : []), '--', p])
}

export async function gitStage(cwd: string, paths: string[], stage: boolean): Promise<void> {
  if (!paths.length) return
  const safe = paths.map(safePath)
  if (stage) await git(cwd, ['add', '--', ...safe])
  else await git(cwd, ['reset', '-q', 'HEAD', '--', ...safe]).catch(() => git(cwd, ['rm', '--cached', '-q', '-r', '--', ...safe])) // before the first commit there is no HEAD
}

/** Commits what is staged. Returns the short hash. */
export async function gitCommit(cwd: string, message: string): Promise<string> {
  const msg = message.trim()
  if (!msg) throw new Error('Write a commit message first.')
  if (!(await gitStatus(cwd)).files.some((f) => f.index && f.index !== '?')) throw new Error('Nothing is staged. Stage files first.')
  await git(cwd, ['commit', '-m', msg])
  return (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
}

/** Plain push of the current branch (sets the upstream on first push). Never forced. */
export async function gitPush(cwd: string): Promise<string> {
  const s = await gitStatus(cwd)
  if (!s.branch) throw new Error('Not on a branch. Create or switch to a branch first.')
  const r = await exec('git', s.upstream ? ['push'] : ['push', '-u', 'origin', s.branch], { cwd, timeoutMs: NET_TIMEOUT, env: NO_PROMPT, merge: true, maxChars: 20_000 })
  if (r.code !== 0) throw new Error(r.stdout.trim().split('\n').slice(-6).join('\n') || 'git push failed')
  return r.stdout.trim() || 'Pushed.'
}

export async function gitBranches(cwd: string): Promise<GitBranches> {
  const out = await git(cwd, ['branch', '--format=%(refname:short)|%(HEAD)']).catch(() => '')
  const lines = out.split('\n').filter(Boolean)
  return { current: lines.find((l) => l.endsWith('|*'))?.split('|')[0] ?? null, branches: lines.map((l) => l.split('|')[0]) }
}

/** Switches to a branch, or creates it from HEAD and switches. The name is checked by git itself. */
export async function gitSwitch(cwd: string, name: string, create: boolean): Promise<void> {
  const n = name.trim()
  if (!n || n.startsWith('-')) throw new Error('Invalid branch name.')
  await git(cwd, ['check-ref-format', '--branch', n]).catch(() => { throw new Error(`"${n}" is not a valid branch name.`) })
  await git(cwd, create ? ['switch', '-c', n] : ['switch', n])
}
