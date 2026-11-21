import { spawn } from 'node:child_process'

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

export interface HookDef {
  matcher?: string // tool-name regex for PreToolUse/PostToolUse; empty or "*" matches all
  command: string
  timeoutMs?: number
}
export type HookConfig = Partial<Record<HookEvent, HookDef[]>>

export const HOOK_TIMEOUT_MS = 60_000
export const MAX_STOP_BLOCKS = 3

/**
 * Settings format (same shape as Claude Code):
 *   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "./check.sh" } ] } ] } }
 * Anything malformed is skipped with a warning; it never throws.
 */
export function parseHooks(raw: unknown, source: string): { config: HookConfig; warnings: string[] } {
  const config: HookConfig = {}
  const warnings: string[] = []
  if (raw === undefined) return { config, warnings }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { config, warnings: [`Ignored "hooks" in ${source}: not an object.`] }
  for (const [event, groups] of Object.entries(raw)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      warnings.push(`Ignored unknown hook event "${event}" in ${source}.`)
      continue
    }
    if (!Array.isArray(groups)) {
      warnings.push(`Ignored hooks.${event} in ${source}: not a list.`)
      continue
    }
    for (const g of groups) {
      const list = g && typeof g === 'object' && Array.isArray((g as any).hooks) ? ((g as any).hooks as unknown[]) : []
      const matcher = typeof (g as any)?.matcher === 'string' ? (g as any).matcher : undefined
      if (!list.length) warnings.push(`Ignored an entry of hooks.${event} in ${source}: it has no "hooks" list.`)
      for (const h of list) {
        const cmd = (h as any)?.command
        if ((h as any)?.type !== 'command' || typeof cmd !== 'string' || !cmd.trim()) {
          warnings.push(`Ignored a hook of hooks.${event} in ${source}: only {"type":"command","command":"..."} is supported.`)
          continue
        }
        const t = (h as any).timeout
        ;(config[event as HookEvent] ??= []).push({ matcher, command: cmd, ...(typeof t === 'number' && t > 0 && { timeoutMs: t * 1000 }) })
      }
    }
  }
  return { config, warnings }
}

export const mergeHooks = (...configs: HookConfig[]): HookConfig => {
  const out: HookConfig = {}
  for (const c of configs) for (const e of HOOK_EVENTS) if (c[e]?.length) (out[e] ??= []).push(...c[e]!)
  return out
}

/** One line per hook, for the trust prompt. */
export const describeHooks = (c: HookConfig): string[] => HOOK_EVENTS.flatMap((e) => (c[e] ?? []).map((h) => `${e}${h.matcher ? `[${h.matcher}]` : ''}: ${h.command}`))

export function matches(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === '*') return true
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName)
  } catch {
    return matcher === toolName // an invalid regex falls back to an exact name
  }
}

export interface HookResult {
  /** Set when a hook exited with 2: the stderr to feed back to the model. */
  block?: string
  /** stdout of hooks that exited 0 (extra context for SessionStart/UserPromptSubmit). */
  output: string[]
  warnings: string[]
}

interface Ran {
  code: number | null
  stdout: string
  stderr: string
  failure?: string
}

function runCommand(def: HookDef, stdin: string, cwd: string, signal?: AbortSignal): Promise<Ran> {
  return new Promise((resolve) => {
    const timeout = def.timeoutMs ?? HOOK_TIMEOUT_MS
    let stdout = ''
    let stderr = ''
    let done = false
    let timedOut = false
    const child = spawn(def.command, { cwd, shell: true, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MCA_PROJECT_DIR: cwd } })
    const killGroup = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {}
    }
    const finish = (r: Ran) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    const timer = setTimeout(() => ((timedOut = true), killGroup(), finish({ code: null, stdout, stderr, failure: `timed out after ${Math.round(timeout / 1000)} s` })), timeout)
    const onAbort = () => (killGroup(), finish({ code: null, stdout, stderr, failure: 'aborted' }))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout = (stdout + d).slice(0, 100_000)))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(0, 100_000)))
    child.on('error', (e) => finish({ code: null, stdout, stderr, failure: `could not start (${e.message})` }))
    child.on('exit', (code) => !timedOut && setTimeout(() => finish({ code, stdout, stderr }), 20)) // let the pipes drain
    child.stdin.on('error', () => {}) // a hook that never reads stdin must not crash us
    child.stdin.end(stdin)
  })
}

export class Hooks {
  constructor(
    private config: HookConfig,
    private cwd: string
  ) {}

  static readonly none = new Hooks({}, '.')

  has(event: HookEvent): boolean {
    return !!this.config[event]?.length
  }

  /**
   * Runs every matching hook of an event, in order. Exit 0 continues; exit 2 blocks (the first block wins and later hooks are skipped);
   * any other exit code, spawn failure or timeout is a warning and the session carries on.
   */
  async run(event: HookEvent, payload: Record<string, unknown>, o: { toolName?: string; signal?: AbortSignal } = {}): Promise<HookResult> {
    const result: HookResult = { output: [], warnings: [] }
    const stdin = JSON.stringify({ hook_event_name: event, cwd: this.cwd, ...payload })
    for (const def of this.config[event] ?? []) {
      if (event === 'PreToolUse' || event === 'PostToolUse') if (!matches(def.matcher, o.toolName ?? '')) continue
      const r = await runCommand(def, stdin, this.cwd, o.signal)
      if (r.failure) result.warnings.push(`Hook "${def.command}" ${r.failure}; continuing.`)
      else if (r.code === 0) r.stdout.trim() && result.output.push(r.stdout.trim())
      else if (r.code === 2) {
        result.block = (r.stderr.trim() || r.stdout.trim() || `Blocked by hook "${def.command}".`).slice(0, 10_000)
        return result
      } else result.warnings.push(`Hook "${def.command}" exited with code ${r.code}${r.stderr.trim() ? `: ${r.stderr.trim().split('\n')[0].slice(0, 200)}` : ''}; continuing.`)
    }
    return result
  }
}
