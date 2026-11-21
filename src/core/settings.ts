import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PermissionMode } from '../shared/types'

export interface Rules {
  allow: string[]
  deny: string[]
  ask: string[]
}

export interface Settings {
  permissions: Rules
  defaultMode?: PermissionMode
  projectAllow: string[] // project-level allow rules (applied only when the workspace is trusted)
  warnings: string[]
  rest: Record<string, unknown> // other keys pass through (hooks, MCP, model: later milestones)
}

const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

async function readJson(file: string, warnings: string[]): Promise<Record<string, any> | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const v = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {}
  warnings.push(`Ignored ${file}: not a valid JSON object.`)
  return undefined
}

/**
 * Merges user (~/.mca) then project settings (.claude, .mca, .mca/settings.local.json; later wins).
 * Untrusted workspace: project `allow` rules and project `defaultMode` are ignored; `deny` and `ask` always apply.
 */
export async function loadSettings(cwd: string, o: { trusted: boolean; home?: string }): Promise<Settings> {
  const warnings: string[] = []
  const user = await readJson(join(o.home ?? homedir(), '.mca', 'settings.json'), warnings)
  const project = []
  for (const f of ['.claude/settings.json', '.mca/settings.json', '.mca/settings.local.json']) {
    const j = await readJson(join(cwd, f), warnings)
    if (j) project.push(j)
  }
  const perm = (j: Record<string, any>, k: keyof Rules) => strings(j.permissions?.[k])
  const out: Settings = { permissions: { allow: [], deny: [], ask: [] }, projectAllow: project.flatMap((j) => perm(j, 'allow')), warnings, rest: {} }
  const layers = [...(user ? [{ j: user, project: false }] : []), ...project.map((j) => ({ j, project: true }))]
  for (const { j, project: isProject } of layers) {
    for (const k of ['allow', 'deny', 'ask'] as const) if (k !== 'allow' || !isProject || o.trusted) out.permissions[k].push(...perm(j, k))
    if (MODES.includes(j.permissions?.defaultMode) && (!isProject || o.trusted)) out.defaultMode = j.permissions.defaultMode
    const { permissions: _p, ...others } = j
    Object.assign(out.rest, others)
  }
  return out
}
