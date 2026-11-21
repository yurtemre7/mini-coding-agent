import { statSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realpathNearest } from './paths'

const stateFile = (home = homedir()) => join(home, '.mca', 'state.json')

type State = { trusted: string[] } & Record<string, unknown>

/** Missing file = empty state. A file that exists but is unreadable or corrupt throws, so it is never silently overwritten. */
async function read(home?: string): Promise<State> {
  let text: string
  try {
    text = await readFile(stateFile(home), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { trusted: [] }
    throw e
  }
  const s = JSON.parse(text)
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('not an object')
  return { ...s, trusted: Array.isArray(s.trusted) ? s.trusted : [] }
}

/** Like read, but an unreadable file counts as empty (for reads only; writers use updateState). */
export const readState = (home?: string): Promise<State> => read(home).catch(() => ({ trusted: [] }))

export async function isTrusted(workspace: string, home?: string): Promise<boolean> {
  return (await read(home).catch(() => ({ trusted: [] as string[] }))).trusted.includes(realpathNearest(workspace))
}

/** Read-modify-write of ~/.mca/state.json (other keys kept). Atomic: a crash never leaves a half-written file. */
export async function updateState(change: (s: State) => void, home?: string): Promise<void> {
  const s = await read(home).catch((e: Error) => {
    throw new Error(`${stateFile(home)} is corrupt (${e.message}); not saving. Fix or delete the file.`)
  })
  change(s)
  await mkdir(join(home ?? homedir(), '.mca'), { recursive: true })
  const tmp = `${stateFile(home)}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2) + '\n')
  await rename(tmp, stateFile(home))
}

export async function trustWorkspace(workspace: string, home?: string): Promise<void> {
  const ws = realpathNearest(workspace)
  await updateState((s) => void (s.trusted.includes(ws) || s.trusted.push(ws)), home)
}

const MAX_RECENT = 10
const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false

/** Most recent first; folders that no longer exist are dropped. */
export async function recentWorkspaces(home?: string): Promise<string[]> {
  const r = (await readState(home)).recent
  return (Array.isArray(r) ? r : []).filter((p): p is string => typeof p === 'string' && isDir(p)).slice(0, MAX_RECENT)
}

export const rememberWorkspace = (dir: string, home?: string) =>
  updateState((s) => void (s.recent = [dir, ...(Array.isArray(s.recent) ? s.recent : []).filter((p) => p !== dir && isDir(p))].slice(0, MAX_RECENT)), home)

export interface Prefs {
  provider?: string
  model?: string
  effort?: string
}
export const loadPrefs = async (home?: string): Promise<Prefs> => {
  const p = (await readState(home)).prefs
  return p && typeof p === 'object' ? (p as Prefs) : {}
}
export const savePrefs = (prefs: Prefs, home?: string) => updateState((s) => void (s.prefs = { ...(s.prefs as object), ...prefs }), home)
