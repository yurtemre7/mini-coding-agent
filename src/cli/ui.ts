import { createInterface } from 'node:readline/promises'
import type { Decision, Effort, PermissionMode, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import { AgentSession, type Frontend } from '../core/agent'
import { loadCommands, parseInput, runCommand } from '../core/commands'
import { DEFAULT_MODELS } from '../core/provider/models'
import { PROVIDER_IDS, providerFromCredentials } from '../core/provider/factory'
import { createPermissions, type Permissions } from '../core/permissions'
import type { ModelProvider } from '../core/provider/types'
import { fastModelFor } from '../core/provider/models'
import { builtinTools } from '../core/registry'
import { startSession } from '../core/session'
import { isTrusted, loadPrefs, trustWorkspace } from '../core/trust'
import { composeSystem } from '../core/system'
import { buildReminder } from '../core/context'
import { describeStatus, McpManager } from '../core/mcp'
import { toolSubject } from '../shared/guards'
import { SYSTEM_PROMPT } from './headless'

export interface Term {
  write(s: string): void
  /** Rejects when the terminal closed or the question was aborted. */
  readLine(question: string): Promise<string>
  color: boolean
}

const oneLine = (v: unknown, max = 120): string => {
  const s = (typeof v === 'string' ? v : (JSON.stringify(v) ?? '')).replace(/\s+/g, ' ')
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** The one-line subject of a tool call: the command, the file, or the pattern. */
export const summarize = (input: unknown): string => oneLine(toolSubject(input) || input)

export function formatPermission(r: PermissionRequest): string {
  return [
    `${r.toolName}: ${summarize(r.input)}`,
    ...(r.reason ? [`  (${r.reason})`] : []),
    ...(r.danger ? ['  WARNING: this can cause damage that cannot be undone. It is asked every time and never remembered.'] : []),
    'Do you want to proceed?',
    r.danger ? '  1. Yes, run it anyway' : '  1. Yes',
    r.danger ? '  2. Yes (same as 1: not remembered)' : `  2. Yes, for this session${r.suggestion ? ` (${r.suggestion})` : ''}`,
    '  3. No, and tell the model what to do instead'
  ].join('\n')
}

/** 1/y = once, 2 = session, 3/n = no. Anything else is undefined so the prompt repeats (never guess an approval). */
export function parseChoice(answer: string): Pick<Decision, 'allow' | 'scope'> | undefined {
  const a = answer.trim().toLowerCase()
  if (a === '1' || a === 'y' || a === 'yes') return { allow: true, scope: 'once' }
  if (a === '2') return { allow: true, scope: 'session' }
  if (a === '3' || a === 'n' || a === 'no') return { allow: false }
  return undefined
}

const ICON = { pending: '☐', in_progress: '◐', completed: '☑' } as const

export function terminalFrontend(t: Term): Frontend {
  let midLine = false
  let inText = false
  const nl = () => midLine && (t.write('\n'), (midLine = false))
  const dim = (s: string) => (t.color ? `\x1b[2m${s}\x1b[0m` : s)
  const yesNo = async (q: string): Promise<boolean> => {
    for (;;) {
      const a = (await t.readLine(q + ' (y/n) ')).trim().toLowerCase()
      if (a === 'y' || a === 'yes') return true
      if (a === 'n' || a === 'no') return false
    }
  }
  return {
    emit(e) {
      const pad = 'parentId' in e && e.parentId ? '  ' : '' // subagent output is indented under its Task call
      if (e.type === 'todos') {
        nl()
        inText = false
        t.write(e.todos.map((x) => `  ${ICON[x.status]} ${x.content}\n`).join(''))
      } else if (e.type === 'text_delta') {
        if (!inText) {
          nl()
          t.write(`${pad}⏺ `)
          inText = true
        }
        t.write(e.text)
        midLine = !e.text.endsWith('\n')
      } else if (e.type === 'tool_start') {
        nl()
        inText = false
        t.write(`${pad}⏺ ${e.name}(${summarize(e.input)})\n`)
      } else if (e.type === 'tool_end') {
        const lines = e.result.split('\n')
        const shown = lines.slice(0, 4).map((l) => oneLine(l, 160))
        t.write(dim(`  ⎿ ${e.isError ? 'error: ' : ''}${shown.join('\n    ')}${lines.length > 4 ? `\n    … +${lines.length - 4} lines` : ''}`) + '\n')
      } else if (e.type === 'notice') {
        nl()
        t.write(`${e.level}: ${e.message}\n`)
      } else if (e.type === 'turn_end') {
        nl()
        inText = false
      }
    },
    async ask(req: PermissionRequest | PlanRequest | TrustRequest): Promise<Decision> {
      nl()
      inText = false
      try {
        if (req.kind === 'plan') {
          t.write(`${req.plan}\n`)
          if (await yesNo('Approve this plan?')) return { allow: true }
          const feedback = (await t.readLine('What should change in the plan? (Enter to skip) ')).trim()
          return { allow: false, ...(feedback && { feedback }) }
        }
        if (req.kind === 'trust') {
          const list = (title: string, xs?: string[]) => (xs?.length ? `${title}\n${xs.map((r) => `  ${r}`).join('\n')}\n` : '')
          t.write(`${req.workspace}\n${list("This workspace's settings define allow rules that run without asking:", req.rules)}${list("This workspace's settings define hooks that run shell commands:", req.hooks)}${list('This workspace defines MCP servers that would be started:', req.mcp)}`)
          return { allow: await yesNo('Trust this workspace?') }
        }
        t.write(formatPermission(req) + '\n')
        for (;;) {
          const c = parseChoice(await t.readLine('> '))
          if (!c) {
            t.write('Enter 1, 2 or 3.\n')
            continue
          }
          if (c.allow) return c
          const feedback = (await t.readLine('What should the model do instead? (Enter to skip) ')).trim()
          return { allow: false, ...(feedback && { feedback }) }
        }
      } catch {
        return { allow: false, feedback: 'No answer (input closed or interrupted).' }
      }
    }
  }
}

/** Ctrl+C: aborts a running turn; at an empty prompt a second press within 2 s exits; typed text is just cleared. */
export class CtrlC {
  private last = -Infinity
  press(state: { busy: boolean; hasInput: boolean }, now = Date.now()): 'abort' | 'clear' | 'warn' | 'exit' {
    if (state.busy) return (this.last = -Infinity), 'abort'
    if (state.hasInput) return (this.last = -Infinity), 'clear'
    if (now - this.last <= 2000) return 'exit'
    this.last = now
    return 'warn'
  }
}

export async function runInteractive(o: {
  provider: ModelProvider
  model: string
  effort?: Effort
  cwd: string
  mode?: PermissionMode
  allowedTools?: string[]
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream & { isTTY?: boolean }
  trust?: boolean // --trust: apply project allow rules without asking or recording
  continue?: boolean // --continue: resume the newest saved session for cwd
  resume?: string // --resume <id>
  home?: string
}): Promise<void> {
  const input = o.input ?? process.stdin
  const output: NodeJS.WritableStream & { isTTY?: boolean } = o.output ?? process.stdout
  const rl = createInterface({ input, output, terminal: output.isTTY })
  const closed = new Promise<never>((_, rej) => rl.once('close', () => rej(new Error('closed'))))
  closed.catch(() => {})
  let question: AbortController | undefined
  const term: Term = {
    write: (s) => void output.write(s),
    color: !!output.isTTY && !process.env.NO_COLOR,
    readLine: (q) => {
      const ac = (question = new AbortController())
      return Promise.race([rl.question(q, { signal: ac.signal }), closed])
    }
  }
  const fe = terminalFrontend(term)

  const make = (trusted: boolean) => createPermissions({ cwd: o.cwd, mode: o.mode, allowedTools: o.allowedTools, trusted, canAsk: true, home: o.home })
  let trusted = !!o.trust || (await isTrusted(o.cwd, o.home))
  let built = await make(trusted)
  for (const w of built.warnings) term.write(`warn: ${w}\n`)
  if (!trusted && (built.ignoredAllow.length || built.ignoredHooks.length || built.ignoredMcp.length)) {
    // ask once; only a yes is recorded
    if ((await fe.ask({ kind: 'trust', workspace: o.cwd, rules: built.ignoredAllow, hooks: built.ignoredHooks, mcp: built.ignoredMcp })).allow) {
      try {
        await trustWorkspace(o.cwd, o.home)
        built = await make((trusted = true))
      } catch (e) {
        term.write(`warn: ${(e as Error).message}\n`)
      }
    }
  }
  const perms: Permissions = built.perms
  let mcp = await McpManager.start(built.mcp, { cwd: o.cwd })
  for (const s of mcp.status) if (s.state !== 'connected') term.write(`warn: MCP server "${s.name}": ${s.message}\n`)
  const session = new AgentSession({ provider: o.provider, model: o.model, effort: o.effort, system: composeSystem(SYSTEM_PROMPT, await loadPrefs(o.home)), tools: [...builtinTools, ...mcp.tools], cwd: o.cwd, frontend: fe, decide: perms.decide, plan: perms, fastModel: fastModelFor(o.provider.id), hooks: built.hooks, reminder: () => buildReminder(o.cwd, { home: o.home }) })

  const cur = { provider: o.provider, model: o.model }
  const saved = startSession(o.cwd, () => ({ provider: cur.provider.id, model: cur.model }), { continue: o.continue, resume: o.resume, home: o.home })
  session.load(saved.messages, saved.transcript)

  let exiting = false
  const ctrl = new CtrlC()
  rl.on('SIGINT', () => {
    const act = ctrl.press({ busy: session.busy, hasInput: rl.line.length > 0 })
    if (act === 'abort') {
      session.abort()
      question?.abort()
      term.write('\n(interrupted)\n')
    } else if (act === 'clear') rl.write(null, { ctrl: true, name: 'u' })
    else if (act === 'warn') {
      term.write('\n(Press Ctrl+C again within 2 s to exit)\n')
      rl.prompt(true)
    } else {
      exiting = true
      rl.close()
    }
  })

  const env = {
    session,
    perms,
    workspace: o.cwd,
    print: (m: string) => term.write(m + '\n'),
    exit: () => void (exiting = true),
    trustWorkspace: async () => {
      await trustWorkspace(o.cwd, o.home)
      const fresh = await make(true)
      for (const r of fresh.perms.rules.allow) if (!perms.rules.allow.includes(r)) perms.rules.allow.push(r)
      session.setHooks(fresh.hooks)
      await mcp.close()
      mcp = await McpManager.start(fresh.mcp, { cwd: o.cwd })
      session.setTools([...builtinTools, ...mcp.tools])
    },
    mcpStatus: () => describeStatus(mcp.status),
    models: {
      current: () => ({ provider: cur.provider.id, model: cur.model }),
      providers: PROVIDER_IDS,
      setModel: async (id: string) => {
        session.setModel({ model: id })
        cur.model = id
      },
      setProvider: async (id: string) => {
        const next = await providerFromCredentials(id as (typeof PROVIDER_IDS)[number]) // throws with the key-setup message when there is no key
        const model = DEFAULT_MODELS[next.id as (typeof PROVIDER_IDS)[number]].main
        session.setModel({ provider: next, model, fastModel: fastModelFor(next.id) })
        Object.assign(cur, { provider: next, model })
        return model
      }
    }
  }
  term.write(`mca (${o.model}) - mode: ${perms.mode}. Type /help for commands.\n`)
  if (saved.note) term.write(`${saved.note}\n`)
  try {
    while (!exiting) {
      let text = await term.readLine('> ')
      while (text.endsWith('\\')) text = text.slice(0, -1) + '\n' + (await term.readLine('… '))
      if (!text.trim()) continue
      const p = parseInput(text, await loadCommands(o.cwd, { home: o.home }))
      if (p.kind === 'unknown') term.write(`Unknown command /${p.name}. Type /help for the list.\n`)
      else if (p.kind === 'command') await runCommand(p.name, p.args, env)
      else {
        try {
          await session.send(p.text)
        } catch (e) {
          term.write(`error: ${(e as Error).message}\n`)
        }
      }
    }
  } catch {
    // input closed (Ctrl+D, Ctrl+C twice, or EOF)
  } finally {
    rl.close()
    await mcp.close() // stops every MCP child process
  }
}
