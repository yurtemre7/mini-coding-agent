import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { AgentSession } from './agent'
import { parseFrontmatter } from './frontmatter'
import { MODES, parseMode, type Permissions } from './permissions'

export const BUILTINS = ['help', 'clear', 'compact', 'mode', 'model', 'provider', 'rewind', 'trust', 'mcp', 'exit'] as const

export type Parsed = { kind: 'prompt'; text: string } | { kind: 'command'; name: string; args: string } | { kind: 'unknown'; name: string }

export interface CustomCommand {
  name: string
  description: string
  body: string
  file: string
}

const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** `.md` files of `~/.claude/commands`, `~/.mca/commands`, `<cwd>/.claude/commands`, `<cwd>/.mca/commands` (later wins). A built-in name is never overridden. */
export async function loadCommands(cwd: string, o: { home?: string } = {}): Promise<CustomCommand[]> {
  const home = o.home ?? homedir()
  const found = new Map<string, CustomCommand>()
  for (const dir of [join(home, '.claude', 'commands'), join(home, '.mca', 'commands'), join(cwd, '.claude', 'commands'), join(cwd, '.mca', 'commands')]) {
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      try {
        const { meta, body } = parseFrontmatter(await readFile(join(dir, f), 'utf8'))
        const name = meta.name ?? f.slice(0, -3)
        if (!COMMAND_NAME.test(name) || (BUILTINS as readonly string[]).includes(name)) continue
        const description = meta.description || body.split('\n').find((l) => l.trim())?.trim().slice(0, 100) || 'Custom command'
        found.set(name, { name, description, body, file: join(dir, f) })
      } catch {
        // unreadable file: not a command
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Shell-like words: "a b" stays one argument. */
const words = (s: string): string[] => Array.from(s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g), (m) => m[1] ?? m[2] ?? m[3])

/** `$ARGUMENTS` is everything after the name, `$1`-`$9` single words. Arguments given to a body that uses neither are appended, so they are never lost. */
export function expandCommand(body: string, args: string): string {
  const w = words(args)
  const uses = /\$ARGUMENTS|\$[1-9]/.test(body)
  const text = body.replace(/\$ARGUMENTS|\$([1-9])/g, (_m, n?: string) => (n ? (w[Number(n) - 1] ?? '') : args))
  return !uses && args.trim() ? `${text.trimEnd()}\n\nArguments: ${args}` : text
}

/** `/name args` is a command. Unknown names are local errors; path-like input (`/Users/x/file`) is a normal prompt. */
export function parseInput(text: string, custom: CustomCommand[] = []): Parsed {
  const t = text.trim()
  if (!t.startsWith('/')) return { kind: 'prompt', text }
  const [first, ...rest] = t.split(/\s+/)
  if (first.indexOf('/', 1) !== -1) return { kind: 'prompt', text }
  const name = first.slice(1)
  if ((BUILTINS as readonly string[]).includes(name)) return { kind: 'command', name, args: rest.join(' ') } // a built-in wins over a file of the same name
  const c = custom.find((x) => x.name === name)
  return c ? { kind: 'prompt', text: expandCommand(c.body, t.slice(first.length).trim()) } : { kind: 'unknown', name }
}

export interface CommandEnv {
  session: AgentSession
  perms: Permissions
  workspace: string
  print(msg: string): void
  exit(): void
  trustWorkspace(): Promise<void>
  /** Status line per MCP server. */
  mcpStatus?(): string[]
  /** Model and provider switching; absent where the frontend has no way to do it. */
  models?: {
    current(): { provider: string; model: string }
    providers: readonly string[]
    setModel(id: string): Promise<void>
    /** Switches to the provider's default model and returns it. */
    setProvider(id: string): Promise<string>
  }
}

export const BUILTIN_INFO: Record<(typeof BUILTINS)[number], string> = {
  help: 'Show the list of commands',
  clear: 'Clear the conversation and start a new chat',
  compact: 'Summarize the conversation to free context',
  mode: 'Show or set the permission mode',
  model: 'Show or set the model',
  provider: 'Show or switch the provider',
  rewind: 'Undo the last turn and its file changes',
  trust: 'Trust this workspace',
  mcp: 'List MCP servers and their status',
  exit: 'Quit'
}

export const HELP = `Commands:
  /help            Show this help
  /clear           Clear the conversation and checkpoints (the saved chat stays; a new one starts)
  /mode [name]     Show or set the permission mode (${MODES.join(' | ')})
  /mcp             List MCP servers (from .mcp.json or the mcpServers setting; trusted workspaces only) and their status
  /rewind          Undo the last turn: restore its files and drop it from the conversation (repeat to go further back)
  /trust           Trust this workspace so its project allow rules apply
  /model [id]      Show or set the model for the next turn
  /provider [id]   Show or switch the provider (needs its API key)
  /compact [focus] Summarize the conversation to free context (also happens automatically at 80% of the window)
  /exit            Quit

Known limits: rewind checkpoints live in memory (lost on restart) and do not cover changes made through Bash.
Ctrl+C aborts a running turn; at an empty prompt press it twice within 2 s to exit. End a line with \\ to continue on the next line.`

export async function runCommand(name: string, args: string, env: CommandEnv): Promise<void> {
  const { session, perms, print } = env
  switch (name) {
    case 'help': {
      const custom = await loadCommands(env.workspace).catch(() => [])
      return print(custom.length ? `${HELP}\n\nCustom commands:\n${custom.map((c) => `  /${c.name.padEnd(15)} ${c.description}`).join('\n')}` : HELP)
    }
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
    case 'model':
    case 'provider': {
      const m = env.models
      if (!m) return print(`/${name} is not available here.`)
      const arg = args.trim()
      const cur = m.current()
      try {
        if (name === 'model') {
          if (!arg) return print(`Model: ${cur.model} (${cur.provider})`)
          await m.setModel(arg)
          return print(`Model set to ${arg}.`)
        }
        if (!arg) return print(`Provider: ${cur.provider} (available: ${m.providers.join(', ')})`)
        if (!m.providers.includes(arg)) return print(`Unknown provider "${arg}". Available: ${m.providers.join(', ')}.`)
        return print(`Provider set to ${arg}; model: ${await m.setProvider(arg)}.`)
      } catch (e) {
        return print((e as Error).message)
      }
    }
    case 'mcp': {
      const lines = env.mcpStatus?.() ?? []
      return print(lines.length ? `MCP servers:\n${lines.map((l) => `  ${l}`).join('\n')}` : 'No MCP servers configured. Add them to .mcp.json or `mcpServers` in a settings file (trusted workspaces only).')
    }
    case 'mode': {
      if (!args) return print(`Permission mode: ${perms.mode} (available: ${MODES.join(', ')})`)
      const m = parseMode(args.trim())
      if (!m) return print(`Unknown mode "${args.trim()}". Available: ${MODES.join(', ')}.`)
      perms.mode = m
      return print(`Permission mode set to ${m}.`)
    }
    case 'rewind': {
      const before = session.history.length
      const restored = await session.rewind().catch((e: Error) => (print(`Rewind failed: ${e.message}`), null))
      if (restored === null) return
      if (!restored) return print('Nothing to rewind.')
      const files = restored.map((p) => relative(env.workspace, p) || p)
      if (session.history.length === before) return print(`Restored files${files.length ? `: ${files.join(', ')}` : ''}. The conversation is unchanged.`)
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
