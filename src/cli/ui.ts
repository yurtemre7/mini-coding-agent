import { createInterface } from 'node:readline/promises'
import type { Decision, Effort, PermissionMode, PermissionRequest, PlanRequest, TrustRequest } from '../shared/types'
import { AgentSession, type Frontend } from '../core/agent'
import { parseInput, runCommand } from '../core/commands'
import { createPermissions, type Permissions } from '../core/permissions'
import type { ModelProvider } from '../core/provider/types'
import { builtinTools } from '../core/registry'
import { startSession } from '../core/session'
import { isTrusted, trustWorkspace } from '../core/trust'
import { buildReminder } from '../core/context'
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
    'Do you want to proceed?',
    '  1. Yes',
    `  2. Yes, for this session${r.suggestion ? ` (${r.suggestion})` : ''}`,
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
      if (e.type === 'text_delta') {
        if (!inText) {
          nl()
          t.write('⏺ ')
          inText = true
        }
        t.write(e.text)
        midLine = !e.text.endsWith('\n')
      } else if (e.type === 'tool_start') {
        nl()
        inText = false
        t.write(`⏺ ${e.name}(${summarize(e.input)})\n`)
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
          return { allow: await yesNo('Approve this plan?') }
        }
        if (req.kind === 'trust') {
          const list = (title: string, xs?: string[]) => (xs?.length ? `${title}\n${xs.map((r) => `  ${r}`).join('\n')}\n` : '')
          t.write(`${req.workspace}\n${list("This workspace's settings define allow rules that run without asking:", req.rules)}${list("This workspace's settings define hooks that run shell commands:", req.hooks)}`)
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
  if (!trusted && (built.ignoredAllow.length || built.ignoredHooks.length)) {
    // ask once; only a yes is recorded
    if ((await fe.ask({ kind: 'trust', workspace: o.cwd, rules: built.ignoredAllow, hooks: built.ignoredHooks })).allow) {
      try {
        await trustWorkspace(o.cwd, o.home)
        built = await make((trusted = true))
      } catch (e) {
        term.write(`warn: ${(e as Error).message}\n`)
      }
    }
  }
  const perms: Permissions = built.perms
  const session = new AgentSession({ provider: o.provider, model: o.model, effort: o.effort, system: SYSTEM_PROMPT, tools: builtinTools, cwd: o.cwd, frontend: fe, decide: perms.decide, hooks: built.hooks, reminder: () => buildReminder(o.cwd, { home: o.home }) })

  const saved = startSession(o.cwd, () => ({ provider: o.provider.id, model: o.model }), { continue: o.continue, resume: o.resume, home: o.home })
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
    }
  }
  term.write(`mca (${o.model}) - mode: ${perms.mode}. Type /help for commands.\n`)
  if (saved.note) term.write(`${saved.note}\n`)
  try {
    while (!exiting) {
      let text = await term.readLine('> ')
      while (text.endsWith('\\')) text = text.slice(0, -1) + '\n' + (await term.readLine('… '))
      if (!text.trim()) continue
      const p = parseInput(text)
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
  }
}
