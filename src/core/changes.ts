import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { createTwoFilesPatch, diffLines } from 'diff'
import type { ChangeSummary } from '../shared/types'

export const MAX_DIFF_BYTES = 2 * 1024 * 1024
export const MAX_DIFF_CHARS = 200_000
const TRUNCATED = '\n[diff truncated]'

const isBinary = (b: Buffer | null): boolean => !!b && b.subarray(0, 8000).includes(0)

/** The workspace-relative path with forward slashes, or undefined when `abs` is outside `root`. */
function rel(root: string, abs: string): string | undefined {
  const r = relative(root, abs)
  if (!r || r.startsWith('..') || isAbsolute(r)) return undefined
  return sep === '/' ? r : r.split(sep).join('/')
}

interface Pair {
  path: string
  before: Buffer | null
  now: Buffer | null
}

async function pairs(images: Map<string, Buffer | null>, root: string): Promise<Pair[]> {
  const out: Pair[] = []
  for (const [abs, before] of images) {
    const path = rel(root, abs)
    if (path === undefined) continue
    const now = await readFile(abs).catch(() => null)
    if (before === null && now === null) continue // created and deleted again
    if (before && now && before.equals(now)) continue
    out.push({ path, before, now })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const tooLarge = (p: Pair): boolean => (p.before?.length ?? 0) > MAX_DIFF_BYTES || (p.now?.length ?? 0) > MAX_DIFF_BYTES
const text = (b: Buffer | null): string => b?.toString('utf8') ?? ''

/** What the agent changed: before-images compared with the files on disk now. Unchanged files and paths outside `root` are left out. */
export async function summarizeChanges(images: Map<string, Buffer | null>, root: string): Promise<ChangeSummary[]> {
  return (await pairs(images, root)).map((p) => {
    const binary = isBinary(p.before) || isBinary(p.now)
    const large = !binary && tooLarge(p)
    let additions = 0
    let deletions = 0
    if (!binary && !large) {
      for (const part of diffLines(text(p.before), text(p.now))) {
        if (part.added) additions += part.count ?? 0
        else if (part.removed) deletions += part.count ?? 0
      }
    }
    return { path: p.path, status: p.before === null ? 'added' : p.now === null ? 'deleted' : 'modified', additions, deletions, binary, tooLarge: large }
  })
}

/** A unified diff for one changed file, a one-line note for binary or very large files, or undefined when `abs` is not among the changes. */
export async function diffFor(images: Map<string, Buffer | null>, root: string, abs: string): Promise<string | undefined> {
  const path = rel(root, abs)
  if (path === undefined || !images.has(abs)) return undefined
  const [p] = await pairs(new Map([[abs, images.get(abs) ?? null]]), root)
  if (!p) return ''
  if (isBinary(p.before) || isBinary(p.now)) return `Binary file differs: ${path}`
  if (tooLarge(p)) return `File too large to diff (over ${MAX_DIFF_BYTES} bytes): ${path}`
  const patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, text(p.before), text(p.now), '', '', { context: 3 })
  return patch.length > MAX_DIFF_CHARS ? patch.slice(0, MAX_DIFF_CHARS) + TRUNCATED : patch
}
