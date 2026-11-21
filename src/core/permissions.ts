import { homedir } from 'node:os'
import { relative } from 'node:path'
import picomatch from 'picomatch'
import type { Decision, PermissionMode, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import { isInsideWorkspace, isProtectedPath, realpathNearest, resolvePath } from './paths'
import { loadSettings, type Rules } from './settings'
import type { Tool, ToolContext } from './tool'

export const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
export const parseMode = (s: string): PermissionMode | undefined => MODES.find((m) => m === s)

/** Built-in `ask` rules: sensitive reads always prompt (step 3 precedes bypassPermissions). */
export const SENSITIVE_READS = ['Read(**/.env*)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)']

/** Splits "--allowed-tools" values on commas and whitespace, but never inside parentheses: `Bash(npm run test:*)` stays whole. */
export function splitRules(list: string[]): string[] {
  const out: string[] = []
  for (const s of list) {
    let depth = 0
    let cur = ''
    for (const c of s) {
      if (c === '(') depth++
      else if (c === ')') depth = Math.max(0, depth - 1)
      if (depth === 0 && /[\s,]/.test(c)) {
        if (cur) out.push(cur)
        cur = ''
      } else cur += c
    }
    if (cur) out.push(cur)
  }
  return out
}

// ---------- Bash command analysis ----------

export interface ParsedCommand {
  segments: string[]
  /** `$(`, backticks, `<(`, `>(` or an unterminated quote: the real command cannot be known statically. */
  subst: boolean
  redirect: boolean
  background: boolean
}

/** Quote-aware split on `&&`, `||`, `;`, `|`, `&` and newlines. */
export function parseCommand(cmd: string): ParsedCommand {
  const r: ParsedCommand = { segments: [], subst: false, redirect: false, background: false }
  let cur = ''
  let quote: '' | "'" | '"' = ''
  const cut = () => {
    if (cur.trim()) r.segments.push(cur.trim())
    cur = ''
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    const n = cmd[i + 1]
    if (quote === "'") {
      if (c === "'") quote = ''
      cur += c
      continue
    }
    if (c === '\\') {
      cur += c + (n ?? '')
      i++
      continue
    }
    if (c === '`' || (c === '$' && n === '(')) r.subst = true // also active inside double quotes
    if (quote === '"') {
      if (c === '"') quote = ''
      cur += c
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if ((c === '<' || c === '>') && n === '(') r.subst = true
    else if (c === '<' || c === '>') r.redirect = true
    if (c === '&' && (n === '>' || cmd[i - 1] === '>' || cmd[i - 1] === '<')) {
      cur += c // part of `&>` / `2>&1`
      continue
    }
    if (c === '&' && n === '&') (cut(), i++)
    else if (c === '|' && n === '|') (cut(), i++)
    else if (c === '&') (r.background = true, cut())
    else if (c === ';' || c === '|' || c === '\n') cut()
    else cur += c
  }
  if (quote) r.subst = true
  cut()
  return r
}

const READ_ONLY_PROGRAMS = new Set(['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'rg', 'echo', 'which', 'file', 'stat', 'du', 'df', 'tree', 'basename', 'dirname', 'realpath', 'uname', 'whoami', 'date', 'true'])
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch'])
const BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes'])

function segmentIsReadOnly(seg: string): boolean {
  const [prog, sub, ...rest] = seg.split(/\s+/)
  if (prog === 'git') {
    if (!GIT_READ.has(sub) || [sub, ...rest].some((a) => a.startsWith('--output') || a.startsWith('--ext-diff'))) return false
    return sub !== 'branch' || rest.every((a) => BRANCH_FLAGS.has(a)) // `git branch -D x` mutates
  }
  if (prog === 'rg') return ![sub, ...rest].some((a) => a?.startsWith('--pre')) // --pre runs a program
  return READ_ONLY_PROGRAMS.has(prog)
}

/** True only when every segment is an allowlisted read-only program with no redirection, substitution or backgrounding. When in doubt: false. */
export function isReadOnlyCommand(cmd: string): boolean {
  const p = parseCommand(cmd)
  return !p.subst && !p.redirect && !p.background && p.segments.length > 0 && p.segments.every(segmentIsReadOnly)
}

// ---------- rules ----------

const alias = (name: string): string => (name === 'Write' ? 'Edit' : name === 'Glob' || name === 'Grep' ? 'Read' : name) // one rule covers the tool family

function parseRule(rule: string): { tool: string; spec?: string } {
  const m = /^([^(]+)\((.*)\)$/s.exec(rule.trim())
  return m ? { tool: alias(m[1]), spec: m[2] } : { tool: alias(rule.trim()) }
}

const expandHome = (s: string): string => s.replace(/^~(?=$|\/)/, homedir())

function pathOf(tool: Tool, input: any, ctx: ToolContext): string | undefined {
  const p = tool.name === 'Glob' || tool.name === 'Grep' ? (input?.path ?? ctx.cwd) : tool.name === 'Read' || tool.name === 'Write' || tool.name === 'Edit' ? input?.file_path : undefined
  return typeof p === 'string' ? resolvePath(ctx.cwd, p) : undefined
}

function globMatches(spec: string, abs: string, root: string): boolean {
  const pat = expandHome(spec)
  const opts = { dot: true }
  const rootReal = realpathNearest(root)
  // lexical and real path both count, so neither a symlink nor /var -> /private/var can slip past a rule
  return [abs, realpathNearest(abs)].some((p) => {
    const target = pat.startsWith('/') ? p : relative(p === abs ? root : rootReal, p) // relative globs are workspace-relative
    return picomatch(pat, opts)(target) || picomatch(pat, opts)(target + '/x') // a directory search (Grep ~/.ssh) matches `dir/**`
  })
}

/** Does a non-Bash rule match this call? Bash is handled per segment in `bashRule`. */
function ruleMatches(rule: string, tool: Tool, input: any, ctx: ToolContext): boolean {
  const { tool: name, spec } = parseRule(rule)
  if (name !== alias(tool.name)) return false
  if (spec === undefined) return true
  if (name === 'WebFetch') {
    const host = (() => {
      try {
        return new URL(input?.url).hostname
      } catch {
        return ''
      }
    })()
    const want = spec.replace(/^domain:/, '')
    return host === want || host.endsWith('.' + want)
  }
  const abs = pathOf(tool, input, ctx)
  return abs !== undefined && globMatches(spec, abs, ctx.root)
}

function bashSpecMatches(spec: string, text: string): boolean {
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2)
    return text === prefix || text.startsWith(prefix + ' ')
  }
  return text === spec
}

/** Bash: deny = any segment (or the whole command) matches; allow = whole command matches exactly, or every segment is covered and nothing is substituted. */
function bashRuleMatches(rules: string[], cmd: string, mode: 'any' | 'all'): boolean {
  const specs = rules.map(parseRule).filter((r) => r.tool === 'Bash')
  if (specs.some((r) => r.spec === undefined)) return true // bare `Bash`
  const p = parseCommand(cmd)
  const hit = (seg: string) => specs.some((r) => bashSpecMatches(r.spec!, seg))
  const whole = specs.some((r) => r.spec === cmd.trim()) // exact-string rules (session grants of compound commands); a prefix rule must never match a whole chain
  if (mode === 'any') return whole || p.segments.some(hit) // shortcut: the inside of $(...) is not scanned for deny rules, but such commands are never auto-allowed
  return !p.subst && (whole || (p.segments.length > 0 && p.segments.every(hit)))
}

function matches(rules: string[], tool: Tool, input: any, ctx: ToolContext, mode: 'any' | 'all'): boolean {
  if (tool.name === 'Bash') return bashRuleMatches(rules, String(input?.command ?? ''), mode)
  return rules.some((r) => ruleMatches(r, tool, input, ctx))
}

const esc = (s: string): string => s.replace(/[()[\]{}*?!+@|\\]/g, '\\$&')

/** The narrowest rule that covers what the user just approved. */
export function sessionRule(tool: Tool, input: any, root: string): string | undefined {
  if (tool.name === 'Bash') {
    const cmd = String(input?.command ?? '').trim()
    const p = parseCommand(cmd)
    if (p.subst) return undefined // never auto-allowed, so a rule would be useless
    if (p.segments.length === 1 && !p.background) return `Bash(${cmd.split(/\s+/).slice(0, 2).join(' ')}:*)`
    return `Bash(${cmd})`
  }
  if (tool.name === 'Edit' || tool.name === 'Write') return `Edit(${esc(realpathNearest(root))}/**)`
  return tool.name
}

const describe = (tool: Tool, input: any): string => (tool.name === 'Bash' ? String(input?.command) : (input?.file_path ?? input?.path ?? input?.pattern ?? input?.url ?? JSON.stringify(input) ?? '').toString())

// ---------- decide() ----------

export interface PermissionOptions {
  mode: PermissionMode
  rules?: Partial<Rules>
  canAsk: boolean // false in headless mode: a needed prompt becomes a denial naming the flags
}

export class Permissions {
  mode: PermissionMode
  readonly rules: Rules
  readonly session: string[] = []
  private canAsk: boolean
  private queue: Promise<unknown> = Promise.resolve()

  constructor(o: PermissionOptions) {
    this.mode = o.mode
    this.canAsk = o.canAsk
    this.rules = { allow: o.rules?.allow ?? [], deny: o.rules?.deny ?? [], ask: [...SENSITIVE_READS, ...(o.rules?.ask ?? [])] }
  }

  /** Bash read-only calls may only touch the workspace and nothing an `ask` rule protects (`cat ~/.ssh/id_rsa` must prompt). */
  private bashStaysHome(cmd: string, ctx: ToolContext): boolean {
    if (!isInsideWorkspace(ctx.root, ctx.cwd)) return false
    return cmd
      .split(/\s+/)
      .slice(1)
      .map((t) => t.replace(/^['"]|['"]$/g, ''))
      .every((t) => {
        if (!t || t.startsWith('-')) return true
        const abs = resolvePath(ctx.cwd, t)
        return isInsideWorkspace(ctx.root, abs) && !this.rules.ask.some((r) => ruleMatches(r, { name: 'Read' } as Tool, { file_path: abs }, ctx))
      })
  }

  /** Returns a denial reason, or undefined to allow. First matching step wins (see the decision order in the plan). */
  decide = async (tool: Tool, input: unknown, ctx: ToolContext): Promise<string | undefined> => {
    const readOnly = typeof tool.readOnly === 'function' ? tool.readOnly(input) : tool.readOnly
    const path = pathOf(tool, input, ctx)
    const isWrite = tool.name === 'Write' || tool.name === 'Edit'
    const inside = path === undefined || isInsideWorkspace(ctx.root, path)
    const all = [...this.rules.allow, ...this.session]
    let reason: string | undefined
    let hard = false // asked by step 3: no allow rule or flag can pre-approve it

    if (matches(this.rules.deny, tool, input, ctx, 'any')) return `${tool.name} is blocked by a deny rule in your settings.` // 1
    if (this.mode === 'plan' && !readOnly) return 'plan mode: present a plan with ExitPlanMode before making changes.' // 2
    if (matches(this.rules.ask, tool, input, ctx, 'any')) reason = 'this path is marked as sensitive' // 3
    else if (isWrite && path && isProtectedPath(path)) reason = 'this file can change permissions or run code'
    if (reason) hard = true
    else {
      if (this.mode === 'bypassPermissions') return undefined // 4
      if (readOnly && inside && (tool.name !== 'Bash' || this.bashStaysHome(String((input as any).command), ctx))) return undefined // 5
      if (matches(all, tool, input, ctx, 'all')) return undefined // 6
      if (this.mode === 'acceptEdits' && isWrite && inside) return undefined // 7
      reason = !inside ? 'it is outside the workspace' : undefined // 8
    }
    return this.prompt(tool, input, ctx, reason, hard)
  }

  private async prompt(tool: Tool, input: unknown, ctx: ToolContext, reason: string | undefined, hard: boolean): Promise<string | undefined> {
    if (!this.canAsk)
      return `${tool.name} needs approval${reason ? ` (${reason})` : ''}, which this session cannot ask for.` +
        (hard ? ' It always needs interactive approval; make the change yourself.' : ` Re-run with --permission-mode acceptEdits (file edits) or bypassPermissions, or allow it with --allowed-tools "${sessionRule(tool, input, ctx.root) ?? tool.name}".`)
    const suggestion = sessionRule(tool, input, ctx.root)
    const req: PermissionRequest = { kind: 'permission', toolName: tool.name, input, ...(reason && { reason }), ...(suggestion && { suggestion }) }
    const d = await this.serialized(req, ctx)
    if (!d.allow) return d.feedback ? `The user declined and said: ${d.feedback}` : 'The user declined this action.'
    if (d.scope === 'session' && suggestion) this.session.push(suggestion)
    return undefined
  }

  /** One prompt at a time, so parallel tool calls and subagents never show two dialogs. A prompt whose turn was aborted while queued is never shown. */
  private serialized(req: PermissionRequest | PlanRequest | TrustRequest, ctx: ToolContext): Promise<Decision> {
    const run = this.queue.then(() => (ctx.signal.aborted ? { allow: false, feedback: 'Aborted' } : ctx.ask(req)))
    this.queue = run.catch(() => undefined)
    return run
  }
}

/** Loads settings (trust-gated), merges CLI rules, and builds the Permissions for a session. */
export async function createPermissions(o: { cwd: string; mode?: PermissionMode; allowedTools?: string[]; trusted: boolean; canAsk: boolean; home?: string }): Promise<{ perms: Permissions; warnings: string[]; ignoredAllow: string[] }> {
  const s = await loadSettings(o.cwd, { trusted: o.trusted, home: o.home })
  const perms = new Permissions({
    mode: o.mode ?? s.defaultMode ?? 'default',
    rules: { ...s.permissions, allow: [...s.permissions.allow, ...splitRules(o.allowedTools ?? [])] },
    canAsk: o.canAsk
  })
  return { perms, warnings: s.warnings, ignoredAllow: o.trusted ? [] : s.projectAllow }
}
