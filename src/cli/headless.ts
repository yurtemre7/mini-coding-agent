import type { Decision, PermissionMode } from '../shared/types'
import { AgentSession, type Frontend, type TurnOptions } from '../core/agent'
import { builtinTools } from '../core/registry'
import type { ModelProvider } from '../core/provider/types'

export const SYSTEM_PROMPT =
  'You are MCA, a coding agent running in the user\'s terminal. Use the available tools to inspect the project, and answer concisely.'

interface Io {
  out(s: string): void
  err(s: string): void
}

/** Plain-text Frontend: answer on stdout, tool activity on stderr. ask() denies: nobody is there to answer. */
export function plainFrontend(io: Io): Frontend {
  return {
    emit(e) {
      if (e.type === 'text_delta') io.out(e.text)
      else if (e.type === 'tool_start') io.err(`⏺ ${e.name}(${JSON.stringify(e.input).slice(0, 200)})\n`)
      else if (e.type === 'tool_end') io.err(`  ⎿ ${e.isError ? 'error: ' : ''}${e.result.split('\n')[0].slice(0, 200)}\n`)
      else if (e.type === 'notice') io.err(`${e.level}: ${e.message}\n`)
    },
    async ask(): Promise<Decision> {
      return { allow: false, feedback: 'Not available in headless mode.' }
    }
  }
}

/** Stub until Milestone 3's rules engine: read-only tools run; everything else needs bypassPermissions because headless cannot ask. */
export function headlessDecide(mode: PermissionMode): NonNullable<TurnOptions['decide']> {
  return async (tool, input) => {
    if (mode === 'bypassPermissions') return undefined
    const ro = typeof tool.readOnly === 'function' ? tool.readOnly(input) : tool.readOnly
    return ro ? undefined : `${tool.name} changes files or runs commands and needs approval, which headless mode cannot ask for. Re-run with --permission-mode bypassPermissions to allow it.`
  }
}

/** Runs one prompt to completion. Returns the process exit code (0 ok, 1 runtime error). */
export async function runHeadless(o: { prompt: string; provider: ModelProvider; model: string; cwd: string; io: Io; permissionMode?: PermissionMode }): Promise<number> {
  const session = new AgentSession({
    provider: o.provider,
    model: o.model,
    system: SYSTEM_PROMPT,
    tools: builtinTools,
    cwd: o.cwd,
    frontend: plainFrontend(o.io),
    decide: headlessDecide(o.permissionMode ?? 'default')
  })
  const reason = await session.send(o.prompt)
  o.io.out('\n')
  return reason === 'done' ? 0 : 1
}
