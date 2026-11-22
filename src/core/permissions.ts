import { homedir } from 'node:os'
import { relative } from 'node:path'
import picomatch from 'picomatch'
import { field, stringField } from '../shared/guards'
import { PERMISSION_MODES, type Decision, type PermissionMode, type PermissionRequest, type PlanRequest, type TrustRequest } from '../shared/types'
import { isInsideWorkspace, isProtectedPath, realpathNearest, resolvePath } from './paths'
import { Hooks } from './hooks'
import type { McpConfig } from './mcp'
import { loadSettings, type Rules } from './settings'
import type { PlanControl, Tool, ToolContext } from './tool'

export const MODES = PERMISSION_MODES
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
  /** `$(`, `$'`, `${`, backticks, `<(`, `>(`, eval/exec/sh -c, a wrapper (env, xargs, sudo, find -exec ...) or an unterminated quote: the real command cannot be known statically. */
  subst: boolean
  redirect: boolean
  background: boolean
}

/** Quote-aware split on `&&`, `||`, `;`, `|`, `&` and newlines. */
export function parseCommand(cmd: string): ParsedCommand {
  cmd = cmd.replace(/\\\n/g, '') // line continuation joins words (r\<newline>m is rm)
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
    if (c === '`' || (c === '$' && (n === '(' || n === "'" || n === '"' || n === '{'))) r.subst = true // $( $' $" ${ and backticks: opaque; also active inside double quotes
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
    if ((c === '&' && n === '&') || (c === '|' && n === '|')) {
      cut()
      i++
    } else if (c === '&') {
      r.background = true
      cut()
    } else if (c === ';' || c === '|' || c === '\n') cut()
    else cur += c
  }
  if (quote || /(^|[\s;&|(])(eval|exec)(\s|$)|(^|[\s;&|(])(ba|z|da|k)?sh\s+-\w*c/.test(cmd)) r.subst = true
  cut()
  if (r.segments.some((g) => WRAPPERS.has(normalizeSegment(g).split(' ')[0]) || (/^find\b/.test(normalizeSegment(g)) && /\s-(exec|execdir|ok|okdir)\b/.test(g)))) r.subst = true // wrappers run another program
  return r
}

const WRAPPERS = new Set(['env', 'xargs', 'nice', 'nohup', 'time', 'command', 'builtin', 'sudo', 'doas', 'exec', 'timeout', 'watch'])

const READ_ONLY_PROGRAMS = new Set(['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'rg', 'grep', 'echo', 'which', 'file', 'stat', 'du', 'df', 'basename', 'dirname', 'realpath', 'uname', 'whoami', 'date', 'true'])
const RG_OPTIONS = /^(-[inlcwFve]+|-[CAB]\d+|--(line-number|ignore-case|files-with-matches|count|fixed-strings|word-regexp|invert-match))$/
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch'])
const BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes'])

function segmentIsReadOnly(seg: string): boolean {
  const [prog, sub, ...rest] = seg.split(/\s+/)
  if (prog === 'git') {
    if (!GIT_READ.has(sub) || [sub, ...rest].some((a) => a.startsWith('--output') || a.startsWith('--ext-diff'))) return false
    return sub !== 'branch' || rest.every((a) => BRANCH_FLAGS.has(a)) // `git branch -D x` mutates
  }
  if (prog === 'rg' || prog === 'grep') return [sub, ...rest].every((a) => !a?.startsWith('-') || RG_OPTIONS.test(a)) // any other option may run a program, follow links or read ignored files
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

function pathOf(tool: Tool, input: unknown, ctx: ToolContext): string | undefined {
  const p = tool.name === 'Glob' || tool.name === 'Grep' ? (field(input, 'path') ?? ctx.cwd) : tool.name === 'Read' || tool.name === 'Write' || tool.name === 'Edit' ? field(input, 'file_path') : undefined
  return typeof p === 'string' ? resolvePath(ctx.cwd, p) : undefined
}

function globMatches(spec: string, abs: string, root: string, realOnly: boolean): boolean {
  const pat = expandHome(spec)
  const opts = { dot: true, nocase: !realOnly && process.platform === 'darwin' } // deny/ask fold case on macOS (cat .ENV); allow stays exact
  const rootReal = realpathNearest(root)
  // deny/ask: lexical or real path matches (stricter). allow: only the real path, so a symlink inside the workspace cannot borrow an allowed glob
  return (realOnly ? [realpathNearest(abs)] : [abs, realpathNearest(abs)]).some((p) => {
    const target = pat.startsWith('/') ? p : relative(p === abs ? root : rootReal, p) // relative globs are workspace-relative
    return picomatch(pat, opts)(target) || picomatch(pat, opts)(target + '/x') // a directory search (Grep ~/.ssh) matches `dir/**`
  })
}

/** Does a non-Bash rule match this call? Bash is handled per segment in `bashRule`. */
function ruleMatches(rule: string, tool: Tool, input: unknown, ctx: ToolContext, realOnly = false): boolean {
  const { tool: name, spec } = parseRule(rule)
  if (name !== alias(tool.name)) return false
  if (spec === undefined) return true
  if (name === 'WebFetch') {
    const host = (() => {
      try {
        return new URL(stringField(input, 'url') ?? '').hostname
      } catch {
        return ''
      }
    })()
    const want = spec.replace(/^domain:/, '')
    return host === want || host.endsWith('.' + want)
  }
  const abs = pathOf(tool, input, ctx)
  return abs !== undefined && globMatches(spec, abs, ctx.root, realOnly)
}

/** One whitespace run = one space; leading `VAR=val` assignments, `(`, `{` and `!` are stripped (and the closing `)`/`}` when a leading one was). */
export function normalizeSegment(seg: string): string {
  let t = seg.replace(/\s+/g, ' ').trim()
  let stripped = false
  for (let prev = ''; prev !== t; ) {
    prev = t
    t = t.replace(/^(?:[({!]\s*|[A-Za-z_]\w*=\S*\s+)/, (m) => ((stripped ||= /^[({!]/.test(m)), ''))
  }
  return stripped ? t.replace(/[\s)}]+$/, '') : t
}

function bashSpecMatches(spec: string, text: string): boolean {
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2)
    return text === prefix || text.startsWith(prefix + ' ')
  }
  return text === spec
}

/** Words of a command with quotes and backslashes removed, split on whitespace and shell punctuation. */
const words = (s: string): string[] => s.replace(/\\\n/g, '').replace(/['"\\]/g, '').split(/[\s;&|()<>{}$`=,]+/).filter(Boolean)

/**
 * Bash. deny/ask ('any'): structural token matching over the WHOLE command, never trusting the shell syntax: quotes/backslashes removed, simple braces
 * collapsed, a rule's words must appear as consecutive tokens (or basenames: /bin/rm). A segment whose command word is computed ($ { * ? [) matches
 * every Bash rule. Over-denying is accepted (`echo rm` is denied).
 * allow ('all'): the whole command equals an exact rule, or every segment (whitespace-normalised, NO env-prefix stripping) matches and the command is not opaque.
 */
function bashRuleMatches(rules: string[], cmd: string, mode: 'any' | 'all'): boolean {
  const specs = rules.map(parseRule).filter((r) => r.tool === 'Bash')
  if (specs.some((r) => r.spec === undefined)) return true // bare `Bash`
  if (!specs.length) return false
  const p = parseCommand(cmd)
  const whole = specs.some((r) => r.spec === cmd.trim()) // exact-string rules (session grants of compound commands); a prefix rule must never match a whole chain
  if (mode === 'all') {
    const hit = (seg: string) => specs.some((r) => bashSpecMatches(r.spec!, seg))
    return !p.subst && (whole || (p.segments.length > 0 && p.segments.map((g) => g.replace(/\s+/g, ' ').trim()).every(hit)))
  }
  if (whole || p.segments.some((g) => specs.some((r) => bashSpecMatches(r.spec!, normalizeSegment(g))))) return true
  if (p.segments.some((g) => /[$*?[{]/.test(normalizeSegment(g).split(' ')[0]))) return true // computed command word: unknowable
  const lists = [words(cmd), words(cmd.replace(/[{},]/g, ''))]
  const base = (t: string) => t.slice(t.lastIndexOf('/') + 1) || t
  return specs.some((r) => {
    const w = words(r.spec!.replace(/:\*$/, ''))
    return w.length > 0 && lists.some((t) => t.some((_, i) => w.every((x, k) => t[i + k] === x || (k === 0 && base(t[i]) === x))))
  })
}

function matches(rules: string[], tool: Tool, input: unknown, ctx: ToolContext, mode: 'any' | 'all'): boolean {
  if (tool.name === 'Bash') return bashRuleMatches(rules, stringField(input, 'command') ?? '', mode)
  return rules.some((r) => ruleMatches(r, tool, input, ctx, mode === 'all'))
}

const esc = (s: string): string => s.replace(/[()[\]{}*?!+@|\\]/g, '\\$&')

/** The narrowest rule that covers what the user just approved. */
export function sessionRule(tool: Tool, input: unknown, root: string): string | undefined {
  if (tool.name === 'Bash') {
    const cmd = (stringField(input, 'command') ?? '').trim()
    const p = parseCommand(cmd)
    if (p.subst) return undefined // never auto-allowed, so a rule would be useless
    const prefix = cmd.split(/\s+/).slice(0, 2).join(' ')
    if (p.segments.length === 1 && !p.background && !/['"\\]/.test(prefix)) return `Bash(${prefix}:*)`
    return `Bash(${cmd})`
  }
  if (tool.name === 'Edit' || tool.name === 'Write') return `Edit(${esc(realpathNearest(root))}/**)`
  if (tool.name === 'WebFetch') {
    try {
      return `WebFetch(domain:${new URL(stringField(input, 'url') ?? '').hostname})`
    } catch {
      return undefined
    }
  }
  return tool.name
}


// ---------- catastrophic commands ----------

const SYSTEM_DIRS = new Set(['bin', 'boot', 'dev', 'etc', 'lib', 'lib64', 'opt', 'sbin', 'sys', 'usr', 'var', 'home', 'root', 'Users', 'System', 'Library', 'Applications', 'Volumes', 'private'])
/** A target whose recursive deletion or permission change ruins the machine: the root, a home directory (the real one too), or a top-level system directory. */
function isVitalTarget(t: string): boolean {
  const home = homedir().replace(/\/+$/, '')
  if (t === '~' || t === '$HOME' || t === '${HOME}') return true
  const rest = t.replace(/^(~|\$HOME|\$\{HOME\})(?=\/)/, '')
  if (rest !== t) return /^\/(\*|\.\*|\.)?\/?$/.test(rest) // ~/  ~/*  ~/.
  if (!t.startsWith('/')) return false
  if (home && (t.replace(/\/+$/, '') === home || /^\/(\*|\.\*|\.)$/.test(t.slice(home.length)) && t.startsWith(home + '/'))) return true // /home/me  /home/me/*
  const parts = t.split('/').filter(Boolean)
  return parts.length === 0 || (parts.length === 1 && (SYSTEM_DIRS.has(parts[0]) || parts[0] === '*')) || (parts.length === 2 && parts[1] === '*' && SYSTEM_DIRS.has(parts[0]))
}

/**
 * Built-in guard, independent of any allow rule or mode (even bypassPermissions): commands that can wipe the machine or the home directory,
 * overwrite a disk, or run downloaded code as a shell. It only ever adds a prompt (never an auto-allow). Commands are split on shell syntax
 * (never on operand names), quotes are removed first, and every word after a dangerous program in the same command counts as its operand.
 * Commands whose words cannot be known statically (`$cmd`, eval) are NOT matched here; they prompt only when no allow-everything mode applies.
 * Over-matching is accepted: a false alarm costs one click.
 */
export function dangerOf(cmd: string): string | undefined {
  const plain = cmd.replace(/\\\n/g, '').replace(/\$\{?HOME\}?/g, '~')
  const base = (w: string) => w.slice(w.lastIndexOf('/') + 1) || w
  for (const seg of parseCommand(plain).segments) {
    const t = words(seg)
    for (let i = 0; i < t.length; i++) {
      const prog = base(t[i])
      const args = t.slice(i + 1)
      const flags = args.filter((a) => a.startsWith('-'))
      const targets = args.filter((a) => !a.startsWith('-'))
      const recursive = flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')
      if (prog === 'rm' && (flags.includes('--no-preserve-root') || (recursive && targets.some(isVitalTarget)))) return 'this command can delete the whole system or your home directory'
      if ((prog === 'chmod' || prog === 'chown' || prog === 'chgrp') && recursive && targets.some(isVitalTarget)) return 'this command recursively changes permissions or ownership across the whole system or your home directory'
      if (prog === 'dd' && args.some((a, k) => a === 'of' && /^\/dev\/(sd|hd|nvme|disk|mmcblk|rdisk)/.test(args[k + 1] ?? ''))) return 'this command can overwrite a disk'
      if ((/^mkfs(\..+)?$|^(fdisk|parted|wipefs|shred)$/.test(prog) || (prog === 'diskutil' && /^(erase|partition|zero|secure|reformat)/i.test(args[0] ?? '')))) return 'this command can erase or repartition a disk'
      if (['shutdown', 'reboot', 'halt', 'poweroff', 'init'].includes(prog) && (prog !== 'init' || /^[06]$/.test(args[0] ?? ''))) return 'this command shuts the machine down'
    }
  }
  const unquoted = plain.replace(/['"\\]/g, '') // bash removes quotes before it opens a target or starts a program
  if (/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/.test(unquoted)) return 'this looks like a fork bomb'
  if (/>\s*\/dev\/(sd|hd|nvme|disk|rdisk)/.test(unquoted)) return 'this command can overwrite a disk'
  if (/\b(curl|wget|fetch)\b[^|;&]*\|\s*(sudo\s+|env\s+)?(\S*\/)?(ba|z|da|k)?sh\b/.test(unquoted)) return 'this pipes a download straight into a shell'
  return undefined
}

// ---------- decide() ----------

export interface PermissionOptions {
  mode: PermissionMode
  rules?: Partial<Rules>
  canAsk: boolean // false in headless mode: a needed prompt becomes a denial naming the flags
}

/** Tools that only organise the agent's own work. Their effects are checked where they happen (a subagent's tools are checked one by one). */
const INTERNAL_TOOLS = new Set(['Task', 'TodoWrite', 'ExitPlanMode'])

export class Permissions implements PlanControl {
  private current: PermissionMode
  private beforePlan: PermissionMode = 'default'
  readonly rules: Rules
  readonly session: string[] = []
  private canAsk: boolean
  private queue: Promise<unknown> = Promise.resolve()

  constructor(o: PermissionOptions) {
    this.current = o.mode
    this.canAsk = o.canAsk
    this.rules = { allow: o.rules?.allow ?? [], deny: o.rules?.deny ?? [], ask: [...SENSITIVE_READS, ...(o.rules?.ask ?? [])] }
  }

  get mode(): PermissionMode {
    return this.current
  }

  /** Entering plan mode remembers the mode it came from, so approving a plan can restore it. */
  set mode(m: PermissionMode) {
    if (m === 'plan' && this.current !== 'plan') this.beforePlan = this.current
    this.current = m
  }

  exitPlan(): PermissionMode {
    this.current = this.beforePlan
    return this.current
  }

  /** Bash read-only calls may only touch the workspace and nothing an `ask` rule protects (`cat ~/.ssh/id_rsa` must prompt). */
  private bashStaysHome(cmd: string, ctx: ToolContext): boolean {
    if (!isInsideWorkspace(ctx.root, ctx.cwd)) return false
    return cmd
      .split(/\s+/)
      .slice(1)
      .every((raw) => {
        const wrapped = /^'[^']*'$|^"[^"]*"$/.test(raw)
        if (!wrapped && /['"\\]/.test(raw)) return false // partial quoting / escapes can spell any path (.e""nv)
        const t = wrapped ? raw.slice(1, -1) : raw
        if (!t) return true
        if (/[$~*?[{\\`]/.test(t)) return false // expansions can name any path
        if (t.startsWith('-')) return !/[=/.]/.test(t) // attached option values (--file=/etc/x, -f/etc/x) are paths in disguise
        const sensitive = (p: string) => this.rules.ask.some((r) => ruleMatches(r, { name: 'Read' } as Tool, { file_path: resolvePath(ctx.cwd, p) }, ctx))
        const colon = t.indexOf(':') // git show REV:path
        if (colon >= 0 && sensitive(t.slice(colon + 1))) return false
        const abs = resolvePath(ctx.cwd, t)
        return isInsideWorkspace(ctx.root, abs) && !sensitive(t)
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
    if (this.mode === 'plan' && !readOnly && tool.name !== 'WebFetch') return 'plan mode: present a plan with ExitPlanMode before making changes.' // 2 (WebFetch only reads: it still asks per domain)
    if (INTERNAL_TOOLS.has(tool.name)) return undefined
    const danger = tool.name === 'Bash' ? dangerOf(stringField(input, 'command') ?? '') : undefined
    if (danger) reason = danger // 3: dangerous commands always need an explicit answer, in every mode
    else if (matches(this.rules.ask, tool, input, ctx, 'any')) reason = 'this path is marked as sensitive' // 3
    else if (isWrite && path && this.mode !== 'bypassPermissions' && isProtectedPath(path)) reason = 'this file can change permissions or run code'
    if (reason) hard = true // only explicit/built-in ask rules and protected paths in non-bypass modes reach here
    else {
      if (this.mode === 'bypassPermissions') return undefined // 4
      if (readOnly && inside && (tool.name !== 'Bash' || this.bashStaysHome(stringField(input, 'command') ?? '', ctx))) return undefined // 5
      if (matches(all, tool, input, ctx, 'all')) return undefined // 6
      if (this.mode === 'acceptEdits' && isWrite && inside) return undefined // 7
      reason = !inside ? 'it is outside the workspace' : undefined // 8
    }
    return this.prompt(tool, input, ctx, reason, hard, !!danger)
  }

  private async prompt(tool: Tool, input: unknown, ctx: ToolContext, reason: string | undefined, hard: boolean, danger = false): Promise<string | undefined> {
    if (!this.canAsk)
      return `${tool.name} needs approval${reason ? ` (${reason})` : ''}, which this session cannot ask for.` +
        (hard ? ' It always needs interactive approval; make the change yourself.' : ` Re-run with --permission-mode acceptEdits (file edits) or bypassPermissions, or allow it with --allowed-tools "${sessionRule(tool, input, ctx.root) ?? tool.name}".`)
    const suggestion = danger ? undefined : sessionRule(tool, input, ctx.root) // a dangerous command is never remembered
    const req: PermissionRequest = { kind: 'permission', toolName: tool.name, input, ...(reason && { reason }), ...(danger && { danger: true as const }), ...(suggestion && { suggestion }) }
    const d = await this.serialized(req, ctx)
    if (!d.allow && ctx.signal.aborted) return 'Aborted.'
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
export async function createPermissions(o: { cwd: string; mode?: PermissionMode; allowedTools?: string[]; trusted: boolean; canAsk: boolean; home?: string }): Promise<{ perms: Permissions; warnings: string[]; ignoredAllow: string[]; hooks: Hooks; ignoredHooks: string[]; mcp: McpConfig; ignoredMcp: string[] }> {
  const s = await loadSettings(o.cwd, { trusted: o.trusted, home: o.home })
  const perms = new Permissions({
    mode: o.mode ?? s.defaultMode ?? 'default',
    rules: { ...s.permissions, allow: [...s.permissions.allow, ...splitRules(o.allowedTools ?? [])] },
    canAsk: o.canAsk
  })
  return { perms, warnings: s.warnings, ignoredAllow: o.trusted ? [] : s.projectAllow, hooks: new Hooks(s.hooks, o.cwd), ignoredHooks: o.trusted ? [] : s.ignoredHooks, mcp: s.mcp, ignoredMcp: o.trusted ? [] : s.ignoredMcp }
}
