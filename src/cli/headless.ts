import { appendFileSync, writeFileSync } from 'node:fs'
import { loadPrefs } from '../core/trust'
import { composeSystem } from '../core/system'
import type { Decision, Effort, PermissionMode } from '../shared/types'
import { AgentSession, type Frontend } from '../core/agent'
import { createPermissions } from '../core/permissions'
import { startSession } from '../core/session'
import { buildReminder } from '../core/context'
import { McpManager } from '../core/mcp'
import { fastModelFor } from '../core/provider/models'
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
    async ask(req): Promise<Decision> {
      if (req.kind === 'plan') {
        io.out(`${req.plan}\n`) // the plan is the output of a plan-mode run
        return { allow: false, feedback: 'Headless mode cannot approve a plan. Stop here; the plan has been shown to the user.' }
      }
      return { allow: false, feedback: 'Not available in headless mode.' }
    }
  }
}

/**
 * Machine-readable trace of a headless run, one JSON object per line: every tool call with its full input,
 * every tool result's error flag by call id, and a final usage total. Written synchronously so a killed run keeps what it had.
 * Subagent requests do not report usage to the parent, so the total covers the main agent only.
 */
export function traceFrontend(inner: Frontend, path: string): { frontend: Frontend; finish(reason: string): void } {
  writeFileSync(path, '')
  const line = (o: unknown) => appendFileSync(path, JSON.stringify(o) + '\n')
  const total = { inputTokens: 0, outputTokens: 0, costUsd: 0, costPartial: false, requests: 0 }
  return {
    frontend: {
      emit(e) {
        if (e.type === 'tool_start') line({ type: 'tool_start', id: e.id, name: e.name, input: e.input, ...(e.parentId && { parentId: e.parentId }) })
        else if (e.type === 'tool_end') line({ type: 'tool_end', id: e.id, isError: e.isError })
        else if (e.type === 'usage' && e.inputTokens !== undefined) {
          total.requests++
          total.inputTokens += e.inputTokens
          total.outputTokens += e.outputTokens ?? 0
          if (e.costUsd === undefined) total.costPartial = true
          else total.costUsd += e.costUsd
        }
        inner.emit(e)
      },
      ask: (req) => inner.ask(req)
    },
    finish(reason) {
      const known = total.requests > 0 && (!total.costPartial || total.costUsd > 0)
      line({ type: 'usage', ...total, costUsd: known ? total.costUsd : null })
      line({ type: 'end', reason })
    }
  }
}

/** Runs one prompt to completion. Returns the process exit code (0 ok, 1 runtime error). */
export async function runHeadless(o: { prompt: string; provider: ModelProvider; model: string; effort?: Effort; cwd: string; io: Io; permissionMode?: PermissionMode; allowedTools?: string[]; trust?: boolean; continue?: boolean; resume?: string; home?: string; trace?: string }): Promise<number> {
  // headless cannot ask, so a call that needs approval is denied with a message naming the flags; untrusted unless --trust
  const { perms, warnings, ignoredAllow, hooks, ignoredHooks, mcp: mcpConfig, ignoredMcp } = await createPermissions({ cwd: o.cwd, mode: o.permissionMode, allowedTools: o.allowedTools, trusted: !!o.trust, canAsk: false, home: o.home })
  for (const w of warnings) o.io.err(`warn: ${w}\n`)
  if (ignoredAllow.length) o.io.err('warn: project allow rules ignored because the workspace is not trusted (pass --trust).\n')
  if (ignoredHooks.length) o.io.err('warn: project hooks ignored because the workspace is not trusted (pass --trust).\n')
  if (ignoredMcp.length) o.io.err('warn: project MCP servers ignored because the workspace is not trusted (pass --trust).\n')
  const mcp = await McpManager.start(mcpConfig, { cwd: o.cwd })
  for (const s of mcp.status) if (s.state !== 'connected') o.io.err(`warn: MCP server "${s.name}": ${s.message}\n`)
  const traced = o.trace ? traceFrontend(plainFrontend(o.io), o.trace) : undefined
  const session = new AgentSession({
    provider: o.provider,
    model: o.model,
    effort: o.effort,
    system: composeSystem(SYSTEM_PROMPT, await loadPrefs(o.home)),
    tools: [...builtinTools, ...mcp.tools],
    cwd: o.cwd,
    frontend: traced?.frontend ?? plainFrontend(o.io),
    decide: perms.decide,
    plan: perms,
    fastModel: fastModelFor(o.provider.id),
    hooks,
    reminder: () => buildReminder(o.cwd, { home: o.home })
  })
  const saved = startSession(o.cwd, () => ({ provider: o.provider.id, model: o.model }), { continue: o.continue, resume: o.resume, home: o.home })
  session.load(saved.messages, saved.transcript)
  if (saved.note) o.io.err(`${saved.note}\n`)
  let reason: Awaited<ReturnType<typeof session.send>> | 'crashed' = 'crashed'
  try {
    reason = await session.send(o.prompt)
  } finally {
    traced?.finish(reason)
    await mcp.close()
  }
  o.io.out('\n')
  return reason === 'done' ? 0 : 1
}
