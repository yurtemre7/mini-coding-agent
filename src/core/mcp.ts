import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { asRecord, field, stringField } from '../shared/guards'
import type { JsonSchema, Tool } from './tool'

export const CONNECT_TIMEOUT_MS = 10_000
export const MAX_RESULT_CHARS = 25_000
const MAX_NAME = 64

export interface McpServerDef {
  command: string
  args: string[]
  env: Record<string, string>
}
export interface McpConfig {
  servers: Record<string, McpServerDef>
  /** Servers that need a transport other than stdio: listed in status, never started. */
  unsupported: string[]
}
export type McpStatus = { name: string; state: 'connected'; tools: number } | { name: string; state: 'failed' | 'unsupported'; message: string }

export const emptyMcp = (): McpConfig => ({ servers: {}, unsupported: [] })

/** `${VAR}` and `${VAR:-default}` from the environment; an unset variable without default becomes an empty string. */
export const expandVars = (s: string, env: Record<string, string | undefined> = process.env): string => s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, dflt?: string) => env[name] ?? dflt ?? '')

/**
 * `{ "mcpServers": { "name": { "command": "npx", "args": [...], "env": { ... } } } }` (the same shape as Claude Code's .mcp.json).
 * Malformed entries are skipped with a warning; `url`/`type: "http"|"sse"` entries are reported as unsupported.
 */
export function parseMcpServers(raw: unknown, source: string): { config: McpConfig; warnings: string[] } {
  const config = emptyMcp()
  const warnings: string[] = []
  if (raw === undefined) return { config, warnings }
  const map = asRecord(raw)
  if (!map) return { config, warnings: [`Ignored "mcpServers" in ${source}: not an object.`] }
  for (const [name, def] of Object.entries(map)) {
    const type = stringField(def, 'type')
    const command = stringField(def, 'command')
    if ((type && type !== 'stdio') || (!command && stringField(def, 'url'))) {
      config.unsupported.push(name)
      continue
    }
    if (!command?.trim()) {
      warnings.push(`Ignored MCP server "${name}" in ${source}: it has no "command".`)
      continue
    }
    const args = field(def, 'args')
    const env = asRecord(field(def, 'env')) ?? {}
    config.servers[name] = {
      command,
      args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [],
      env: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'))
    }
  }
  return { config, warnings }
}

export function mergeMcp(...configs: McpConfig[]): McpConfig {
  const out = emptyMcp()
  for (const c of configs) {
    Object.assign(out.servers, c.servers) // later (project) definitions replace earlier ones of the same name
    out.unsupported.push(...c.unsupported.filter((n) => !out.unsupported.includes(n)))
  }
  return out
}

/** One line per server, for the trust prompt. */
export const describeMcp = (c: McpConfig): string[] => Object.entries(c.servers).map(([name, d]) => `${name}: ${[d.command, ...d.args].join(' ')}`)

const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')

/** `mcp__<server>__<tool>`, sanitized and capped at 64 characters; a collision gets a numeric suffix. */
export function mcpToolName(server: string, tool: string, used: Set<string>): string {
  const base = `mcp__${clean(server)}__${clean(tool)}`.slice(0, MAX_NAME)
  let name = base
  for (let n = 2; used.has(name); n++) name = `${base.slice(0, MAX_NAME - String(n).length - 1)}_${n}`
  used.add(name)
  return name
}

/** The slice of the SDK client we use, so tests can inject a fake. */
export interface McpClientLike {
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema: unknown }[] }>
  callTool(params: { name: string; arguments: Record<string, unknown> }, signal: AbortSignal): Promise<{ content?: unknown; isError?: boolean }>
  close(): Promise<void>
}
export type McpConnector = (name: string, def: McpServerDef, cwd: string) => Promise<McpClientLike>

/** Starts the server as a child process (stdio transport) and completes the MCP handshake. */
export const connectStdio: McpConnector = async (name, def, cwd) => {
  const transport = new StdioClientTransport({
    command: expandVars(def.command),
    args: def.args.map((a) => expandVars(a)),
    env: { ...getDefaultEnvironment(), ...Object.fromEntries(Object.entries(def.env).map(([k, v]) => [k, expandVars(v)])) },
    cwd,
    stderr: 'pipe'
  })
  transport.stderr?.on('data', () => {}) // drained: a chatty server must not block on a full pipe
  const client = new Client({ name: 'mca', version: '0.1.0' })
  try {
    await client.connect(transport)
  } catch (e) {
    await transport.close().catch(() => {})
    throw e
  }
  return {
    listTools: async () => client.listTools(),
    callTool: async (params, signal) => (await client.callTool(params, undefined, { signal })) as { content?: unknown; isError?: boolean },
    close: () => client.close()
  }
}

/** Text of a tool result. Anything that is not text becomes a placeholder, and the whole result is capped. */
export function resultText(content: unknown): string {
  const parts = (Array.isArray(content) ? content : []).map((c): string => {
    const type = stringField(c, 'type')
    if (type === 'text') return stringField(c, 'text') ?? ''
    if (type === 'image' || type === 'audio') return `[${type}: ${stringField(c, 'mimeType') ?? 'unknown type'}, not shown]`
    if (type === 'resource') return `[resource: ${stringField(asRecord(field(c, 'resource')), 'uri') ?? 'embedded'}, not shown]`
    return `[${type ?? 'unknown'} content, not shown]`
  })
  const text = parts.join('\n')
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated: ${text.length - MAX_RESULT_CHARS} more characters]` : text
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)
    p.then(resolve, reject).finally(() => clearTimeout(t))
  })

const asSchema = (s: unknown): JsonSchema => asRecord(s) ?? { type: 'object', properties: {} }

export class McpManager {
  readonly tools: Tool[] = []
  readonly status: McpStatus[] = []
  private clients: McpClientLike[] = []

  /** Connects every server in parallel. A server that fails or is too slow is reported and skipped: it never blocks the session. */
  static async start(config: McpConfig, o: { cwd: string; connect?: McpConnector; timeoutMs?: number }): Promise<McpManager> {
    const m = new McpManager()
    const connect = o.connect ?? connectStdio
    const timeout = o.timeoutMs ?? CONNECT_TIMEOUT_MS
    for (const name of config.unsupported) m.status.push({ name, state: 'unsupported', message: 'only stdio servers are supported' })
    const used = new Set<string>()
    type Result = { name: string; error: string } | { name: string; error?: undefined; client: McpClientLike; tools: { name: string; description?: string; inputSchema: unknown }[] }
    const results = await Promise.all<Result>(
      Object.entries(config.servers).map(async ([name, def]) => {
        const pending = connect(name, def, o.cwd)
        try {
          // the timeout covers the handshake and the tool listing
          const tools = await withTimeout(pending.then(async (c) => (await c.listTools()).tools), timeout, `Connecting to MCP server "${name}"`)
          return { name, client: await pending, tools }
        } catch (e) {
          pending.then(closeQuietly, () => {}) // a client that connects after we gave up must not leak its child process
          return { name, error: e instanceof Error ? e.message : String(e) }
        }
      })
    )
    for (const r of results) {
      if (r.error !== undefined) {
        m.status.push({ name: r.name, state: 'failed', message: r.error })
        continue
      }
      m.clients.push(r.client)
      for (const t of r.tools) {
        const name = mcpToolName(r.name, t.name, used)
        m.tools.push({
          name,
          description: `[MCP server ${r.name}] ${t.description ?? t.name}`,
          schema: asSchema(t.inputSchema),
          readOnly: false, // never trusted, whatever annotations the server sends
          run: async (input, ctx) => {
            const res = await r.client.callTool({ name: t.name, arguments: asRecord(input) ?? {} }, ctx.signal)
            const text = resultText(res.content)
            if (res.isError) throw new Error(text || 'The MCP tool reported an error.')
            return text
          }
        })
      }
      m.status.push({ name: r.name, state: 'connected', tools: r.tools.length })
    }
    return m
  }

  /** Stops every child process. Safe to call twice. */
  async close(): Promise<void> {
    const clients = this.clients.splice(0)
    await Promise.all(clients.map((c) => c.close().catch(() => {})))
  }
}

const closeQuietly = (c: McpClientLike): void => void c.close().catch(() => {})

export const describeStatus = (status: McpStatus[]): string[] =>
  status.map((s) => (s.state === 'connected' ? `${s.name}: connected, ${s.tools} tool${s.tools === 1 ? '' : 's'}` : `${s.name}: ${s.state} (${s.message})`))
