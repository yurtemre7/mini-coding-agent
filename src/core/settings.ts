import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { asRecord, field } from '../shared/guards'
import { PERMISSION_MODES, type PermissionMode } from '../shared/types'
import { describeMcp, emptyMcp, mergeMcp, parseMcpServers, type McpConfig } from './mcp'
import { describeHooks, mergeHooks, parseHooks, type HookConfig } from './hooks'

export interface Rules {
  allow: string[]
  deny: string[]
  ask: string[]
}

export interface Settings {
  permissions: Rules
  defaultMode?: PermissionMode
  projectAllow: string[] // project-level allow rules (applied only when the workspace is trusted)
  hooks: HookConfig // user hooks always; project hooks only when the workspace is trusted
  ignoredHooks: string[] // project hooks left out because the workspace is not trusted (shown in the trust prompt)
  mcp: McpConfig // user servers always; project servers (settings and .mcp.json) only when the workspace is trusted
  ignoredMcp: string[] // project servers left out because the workspace is not trusted
  warnings: string[]
  rest: Record<string, unknown> // other keys pass through (MCP, model); project keys only when trusted
}

const isPermissionMode = (v: unknown): v is PermissionMode => (PERMISSION_MODES as readonly unknown[]).includes(v)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

async function readJson(file: string, warnings: string[]): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const v = asRecord(JSON.parse(text))
    if (v) return v
  } catch {
    // falls through to the warning below
  }
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
  const mcpFile = await readJson(join(cwd, '.mcp.json'), warnings)
  for (const f of ['.claude/settings.json', '.mca/settings.json', '.mca/settings.local.json']) {
    const j = await readJson(join(cwd, f), warnings)
    if (j) project.push(j)
  }
  const perm = (j: Record<string, unknown>, k: keyof Rules) => strings(field(j.permissions, k))
  const out: Settings = { permissions: { allow: [], deny: [], ask: [] }, projectAllow: project.flatMap((j) => perm(j, 'allow')), hooks: {}, ignoredHooks: [], mcp: emptyMcp(), ignoredMcp: [], warnings, rest: {} }
  const parsed: HookConfig[] = []
  const servers: McpConfig[] = []
  const layers = [...(user ? [{ j: user, project: false }] : []), ...project.map((j) => ({ j, project: true }))]
  for (const { j, project: isProject } of layers) {
    for (const k of ['allow', 'deny', 'ask'] as const) if (k !== 'allow' || !isProject || o.trusted) out.permissions[k].push(...perm(j, k))
    const mode = field(j.permissions, 'defaultMode')
    if (isPermissionMode(mode) && (!isProject || o.trusted)) out.defaultMode = mode
    const h = parseHooks(j.hooks, isProject ? 'project settings' : '~/.mca/settings.json')
    warnings.push(...h.warnings)
    if (!isProject || o.trusted) parsed.push(h.config)
    else out.ignoredHooks.push(...describeHooks(h.config))
    const m = parseMcpServers(j.mcpServers, isProject ? 'project settings' : '~/.mca/settings.json')
    warnings.push(...m.warnings)
    if (!isProject || o.trusted) servers.push(m.config)
    else out.ignoredMcp.push(...describeMcp(m.config))
    const { permissions: _p, hooks: _h, mcpServers: _m, ...others } = j
    if (!isProject || o.trusted) Object.assign(out.rest, others) // untrusted project keys (future hooks/MCP) must not skip the trust gate
  }
  if (mcpFile) {
    const m = parseMcpServers(mcpFile.mcpServers, '.mcp.json')
    warnings.push(...m.warnings)
    if (o.trusted) servers.push(m.config)
    else out.ignoredMcp.push(...describeMcp(m.config))
  }
  out.mcp = mergeMcp(...servers)
  out.hooks = mergeHooks(...parsed)
  return out
}
