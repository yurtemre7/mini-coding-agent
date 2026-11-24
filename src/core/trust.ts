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

const MAX_RECENT = 30
const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false
const list = (s: State): string[] => (Array.isArray(s.recent) ? s.recent : []).filter((p): p is string => typeof p === 'string')

/** The user's workspace list in the order they arranged it (a newly opened folder goes on top); folders that no longer exist are dropped. */
export async function recentWorkspaces(home?: string): Promise<string[]> {
  return list(await readState(home)).filter(isDir).slice(0, MAX_RECENT)
}

/** Adds a folder on top of the list (an existing entry keeps its place) and records it as the one to reopen at launch. */
export const rememberWorkspace = (dir: string, home?: string) =>
  updateState((s) => {
    const rest = list(s).filter(isDir)
    s.recent = (rest.includes(dir) ? rest : [dir, ...rest]).slice(0, MAX_RECENT)
    s.last = dir
  }, home)

/** The workspace that was open last, if it still exists; otherwise the top of the list. */
export async function lastWorkspace(home?: string): Promise<string | undefined> {
  const s = await readState(home)
  const all = await recentWorkspaces(home)
  return typeof s.last === 'string' && all.includes(s.last) ? s.last : all[0]
}

/** Saves a new order. Unknown paths are ignored and entries missing from `order` keep their relative order at the end, so nothing is ever lost. */
export const reorderWorkspaces = (order: string[], home?: string) =>
  updateState((s) => {
    const cur = list(s)
    const first = [...new Set(order)].filter((p) => cur.includes(p))
    s.recent = [...first, ...cur.filter((p) => !first.includes(p))]
  }, home)

/** Removes a workspace from the recent list only; its files, saved chats and trust decision are left alone. */
export const forgetWorkspace = (dir: string, home?: string) => updateState((s) => void (s.recent = (Array.isArray(s.recent) ? s.recent : []).filter((p) => p !== dir)), home)

export interface Prefs {
  provider?: string
  model?: string
  effort?: string
  notifications?: boolean
  /** Custom instructions for the model; added after the built-in prompt, or used instead of it when systemReplace is set. */
  systemPrompt?: string
  systemReplace?: boolean
  /** Most tokens of conversation to keep before summarizing; 0 or absent = the model's own size. */
  contextLimit?: number
}
export const loadPrefs = async (home?: string): Promise<Prefs> => {
  const p = (await readState(home)).prefs
  return p && typeof p === 'object' ? (p as Prefs) : {}
}
export const savePrefs = (prefs: Prefs, home?: string) => updateState((s) => void (s.prefs = { ...(s.prefs as object), ...prefs }), home)

/** Names of skills the user switched off in Settings. */
export async function disabledSkills(home?: string): Promise<string[]> {
  const v = (await readState(home)).disabledSkills
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
export const setSkillEnabled = (name: string, enabled: boolean, home?: string) =>
  updateState((s) => {
    const off = (Array.isArray(s.disabledSkills) ? s.disabledSkills : []).filter((x): x is string => typeof x === 'string' && x !== name)
    s.disabledSkills = enabled ? off : [...off, name]
  }, home)
