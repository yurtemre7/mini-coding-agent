import { relative } from 'node:path'
import type { AgentSession } from './agent'
import { MODES, parseMode, type Permissions } from './permissions'

export const BUILTINS = ['help', 'clear', 'compact', 'mode', 'model', 'provider', 'rewind', 'trust', 'exit'] as const

export type Parsed = { kind: 'prompt'; text: string } | { kind: 'command'; name: string; args: string } | { kind: 'unknown'; name: string }

/** `/name args` is a command. Unknown names are local errors; path-like input (`/Users/x/file`) is a normal prompt. */
export function parseInput(text: string): Parsed {
  const t = text.trim()
  if (!t.startsWith('/')) return { kind: 'prompt', text }
  const [first, ...rest] = t.split(/\s+/)
  if (first.indexOf('/', 1) !== -1) return { kind: 'prompt', text }
  const name = first.slice(1)
  return (BUILTINS as readonly string[]).includes(name) ? { kind: 'command', name, args: rest.join(' ') } : { kind: 'unknown', name }
}

export interface CommandEnv {
  session: AgentSession
  perms: Permissions
  workspace: string
  print(msg: string): void
  exit(): void
  trustWorkspace(): Promise<void>
}

export const HELP = `Commands:
  /help            Show this help
  /clear           Clear the conversation and checkpoints (the saved chat stays; a new one starts)
  /mode [name]     Show or set the permission mode (${MODES.join(' | ')})
  /rewind          Undo the last turn: restore its files and drop it from the conversation (repeat to go further back)
  /trust           Trust this workspace so its project allow rules apply
  /compact [focus] Summarize the conversation to free context (also happens automatically at 80% of the window)
  /model, /provider   Not available yet
  /exit            Quit

Known limits: rewind checkpoints live in memory (lost on restart) and do not cover changes made through Bash.
Ctrl+C aborts a running turn; at an empty prompt press it twice within 2 s to exit. End a line with \\ to continue on the next line.`

export async function runCommand(name: string, args: string, env: CommandEnv): Promise<void> {
  const { session, perms, print } = env
  switch (name) {
    case 'help':
      return print(HELP)
    case 'exit':
      return env.exit()
    case 'clear':
      if (session.busy) return print('A turn is running.')
      session.clear()
      return print('Conversation cleared.')
    case 'compact':
      if (session.busy) return print('A turn is running.')
      try {
        if (!(await session.compact(args.trim() || undefined))) print('Nothing to compact.')
      } catch (e) {
        print(`Compaction failed: ${(e as Error).message}`)
      }
      return
    case 'mode': {
      if (!args) return print(`Permission mode: ${perms.mode} (available: ${MODES.join(', ')})`)
      const m = parseMode(args.trim())
      if (!m) return print(`Unknown mode "${args.trim()}". Available: ${MODES.join(', ')}.`)
      perms.mode = m
      return print(`Permission mode set to ${m}.`)
    }
    case 'rewind': {
      const restored = await session.rewind().catch((e: Error) => (print(`Rewind failed: ${e.message}`), null))
      if (restored === null) return
      if (!restored) return print('Nothing to rewind.')
      const files = restored.map((p) => relative(env.workspace, p) || p)
      return print(files.length ? `Rewound the last turn. Restored: ${files.join(', ')}` : 'Rewound the last turn (it changed no files).')
    }
    case 'trust':
      try {
        await env.trustWorkspace()
      } catch (e) {
        return print((e as Error).message)
      }
      return print(`Trusted ${env.workspace}. Its project allow rules are now active.`)
    default:
      return print(`/${name} is not available yet.`)
  }
}
