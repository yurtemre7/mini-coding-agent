import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { exec } from './exec'
import { discoverSkills, skillsIndex } from './skill'

export const MAX_FILE_CHARS = 40_000
export const MAX_TOTAL_CHARS = 100_000
export const MAX_IMPORT_DEPTH = 5
const GIT_TIMEOUT_MS = 2000
const GIT_STATUS_LINES = 40

const isBinary = (s: string) => s.slice(0, 8000).includes('\0')

/** `@path` tokens outside code fences and inline code are replaced by the file's content. A missing or binary target stays literal text. */
export async function expandImports(text: string, file: string, home: string, depth = 0, visited: Set<string> = new Set()): Promise<string> {
  let real = file
  try {
    real = await realpath(file)
  } catch {
    // a file that cannot be resolved is tracked under its given path
  }
  visited.add(real)
  if (depth >= MAX_IMPORT_DEPTH) return text
  const lines = text.split('\n')
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fenced = !fenced
      continue
    }
    if (fenced || !lines[i].includes('@')) continue
    const parts = lines[i].split(/(`[^`]*`)/) // odd indexes are code spans
    for (let p = 0; p < parts.length; p += 2) {
      const pieces: (string | Promise<string>)[] = []
      let last = 0
      for (const m of parts[p].matchAll(/(^|\s)@(\S+)/g)) {
        const token = m[2].replace(/[.,;:!?)\]]+$/, '')
        const start = m.index! + m[1].length
        pieces.push(parts[p].slice(last, start))
        last = start + 1 + token.length
        pieces.push(importOne(token, file, home, depth, visited).then((r) => r ?? `@${token}`))
      }
      if (!pieces.length) continue
      pieces.push(parts[p].slice(last))
      parts[p] = (await Promise.all(pieces)).join('')
    }
    lines[i] = parts.join('')
  }
  return lines.join('\n')
}

async function importOne(token: string, from: string, home: string, depth: number, visited: Set<string>): Promise<string | undefined> {
  const target = token.startsWith('~/') ? join(home, token.slice(2)) : resolve(dirname(from), token)
  try {
    const real = await realpath(target)
    if (visited.has(real)) return undefined // cycle: keep the literal token
    const st = await stat(real)
    if (!st.isFile() || st.size > 1_000_000) return undefined
    const body = await readFile(real, 'utf8')
    if (isBinary(body)) return undefined
    return await expandImports(body, target, home, depth + 1, new Set(visited))
  } catch {
    return undefined
  }
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  const r = await exec('git', ['rev-parse', '--show-toplevel'], { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  return r && r.code === 0 && r.stdout.trim() ? r.stdout.trim() : undefined
}

export interface InstructionFile {
  path: string
  content: string
}

/** User files first, then every directory from the git root down to cwd (AGENTS.md, CLAUDE.md, CLAUDE.local.md). De-duplicated by realpath and by content. */
export async function discoverInstructions(cwd: string, o: { home?: string } = {}): Promise<InstructionFile[]> {
  const home = o.home ?? homedir()
  const candidates = [join(home, '.mca', 'AGENTS.md'), join(home, '.claude', 'CLAUDE.md')]
  // git reports the real path; a symlinked cwd (macOS /var -> /private/var) must be resolved the same way or relative() climbs out of the repo
  const realCwd = await realpath(cwd).catch(() => cwd)
  const root = (await gitRoot(realCwd)) ?? realCwd
  const rel = relative(root, realCwd)
  const dirs = [root]
  if (rel && !rel.startsWith('..')) {
    let d = root
    for (const part of rel.split(sep)) dirs.push((d = join(d, part)))
  }
  for (const d of dirs) for (const n of ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md']) candidates.push(join(d, n))
  const seenPaths = new Set<string>()
  const seenHashes = new Set<string>()
  const out: InstructionFile[] = []
  for (const file of candidates) {
    let real: string
    let raw: string
    try {
      real = await realpath(file)
      if (seenPaths.has(real)) continue
      raw = await readFile(real, 'utf8')
    } catch {
      continue
    }
    seenPaths.add(real)
    if (isBinary(raw) || !raw.trim()) continue
    const hash = createHash('sha256').update(raw).digest('hex')
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    out.push({ path: file, content: await expandImports(raw, file, home) })
  }
  return out
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max)}\n... [truncated: ${s.length - max} more characters]`)

async function gitSnapshot(cwd: string): Promise<string | undefined> {
  const git = (args: string[]) => exec('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  const inside = await git(['rev-parse', '--is-inside-work-tree'])
  if (!inside || inside.code !== 0) return undefined
  const [branch, status, log] = await Promise.all([git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['status', '--short']), git(['log', '--oneline', '-n', '5'])])
  const lines = (status?.code === 0 ? status.stdout : '').split('\n').filter(Boolean)
  const shown = lines.slice(0, GIT_STATUS_LINES)
  return [
    `Git branch: ${branch?.code === 0 ? branch.stdout.trim() || '(unknown)' : '(unknown)'}`,
    `Git status:${lines.length ? `\n${shown.join('\n')}${lines.length > shown.length ? `\n... and ${lines.length - shown.length} more` : ''}` : ' clean'}`,
    ...(log?.code === 0 && log.stdout.trim() ? [`Recent commits:\n${log.stdout.trim()}`] : [])
  ].join('\n')
}

/**
 * The volatile part of the context: date, git snapshot and instruction files. It goes into the first user message of a session
 * (inside a <system-reminder> block), so the system prompt itself stays byte-stable and the provider's prompt cache keeps working.
 */
export async function buildReminder(cwd: string, o: { home?: string; now?: Date; extra?: string[] } = {}): Promise<string> {
  const sections = [`Today's date is ${(o.now ?? new Date()).toISOString().slice(0, 10)}.`, `Working directory: ${cwd}`]
  const git = await gitSnapshot(cwd)
  if (git) sections.push(git)
  let budget = MAX_TOTAL_CHARS
  for (const f of await discoverInstructions(cwd, { home: o.home })) {
    if (budget <= 0) {
      sections.push(`(Instruction file ${f.path} omitted: the ${MAX_TOTAL_CHARS}-character budget is used up.)`)
      continue
    }
    const body = clip(f.content, Math.min(MAX_FILE_CHARS, budget))
    budget -= body.length
    sections.push(`Instructions from ${f.path}:\n${body}`)
  }
  const skills = skillsIndex(await discoverSkills(cwd, { home: o.home }))
  if (skills) sections.push(skills)
  sections.push(...(o.extra ?? []))
  return `<system-reminder>\n${sections.join('\n\n')}\n</system-reminder>`
}
