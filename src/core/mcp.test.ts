import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeStatus, expandVars, mcpToolName, McpManager, parseMcpServers, resultText, type McpClientLike, type McpConnector } from './mcp'
import { loadSettings } from './settings'
import { testCtx } from './tools/testutil'

describe('config parsing', () => {
  it('reads stdio servers, reports other transports as unsupported and skips malformed entries', () => {
    const { config, warnings } = parseMcpServers({ a: { command: 'node', args: ['s.js', 3], env: { K: 'v', N: 1 } }, b: { url: 'https://x' }, c: { type: 'sse', url: 'x' }, d: {} }, 'test')
    expect(config.servers).toEqual({ a: { command: 'node', args: ['s.js'], env: { K: 'v' } } })
    expect(config.unsupported).toEqual(['b', 'c'])
    expect(warnings).toHaveLength(1)
  })
  it('expands ${VAR} and ${VAR:-default}', () => {
    expect(expandVars('${A}/${B:-x}/${C}', { A: '1' })).toBe('1/x/')
  })
  it('sanitizes tool names, caps them at 64 characters and numbers collisions', () => {
    const used = new Set<string>()
    expect(mcpToolName('my server', 'do.it!', used)).toBe('mcp__my_server__do_it_')
    expect(mcpToolName('my_server', 'do_it_', used)).toBe('mcp__my_server__do_it__2')
    const long = mcpToolName('s', 'x'.repeat(100), used)
    expect(long).toHaveLength(64)
    expect(mcpToolName('s', 'x'.repeat(100), used)).toHaveLength(64)
    expect(used.size).toBe(4)
  })
  it('turns non-text content into placeholders and caps the size', () => {
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png' }])).toBe('a\n[image: image/png, not shown]')
    expect(resultText([{ type: 'text', text: 'x'.repeat(30_000) }])).toContain('truncated: 5000 more characters')
  })
})

describe('settings sources and the trust gate', () => {
  it('project servers (.mcp.json and settings) start only in a trusted workspace; user servers always', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mca-h-'))
    const ws = mkdtempSync(join(tmpdir(), 'mca-w-'))
    writeFileSync(join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { proj: { command: 'p' } } }))
    const untrusted = await loadSettings(ws, { trusted: false, home })
    expect(untrusted.mcp.servers).toEqual({})
    expect(untrusted.ignoredMcp).toEqual(['proj: p'])
    const trusted = await loadSettings(ws, { trusted: true, home })
    expect(Object.keys(trusted.mcp.servers)).toEqual(['proj'])
  })
})

const fakeClient = (tools: string[], over: Partial<McpClientLike> = {}): McpClientLike & { closed: boolean } => ({
  closed: false,
  listTools: async () => ({ tools: tools.map((name) => ({ name, inputSchema: { type: 'object', properties: {} } })) }),
  callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  async close() {
    this.closed = true
  },
  ...over
})

describe('McpManager', () => {
  it('a failing or hanging server is reported and never blocks the others', async () => {
    const good = fakeClient(['t'])
    const late = fakeClient([])
    const connect: McpConnector = async (name) => {
      if (name === 'good') return good
      if (name === 'bad') throw new Error('spawn ENOENT')
      await new Promise((r) => setTimeout(r, 80))
      return late
    }
    const m = await McpManager.start({ servers: { good: { command: 'x', args: [], env: {} }, bad: { command: 'x', args: [], env: {} }, slow: { command: 'x', args: [], env: {} } }, unsupported: ['remote'] }, { cwd: '/', connect, timeoutMs: 30 })
    expect(m.tools.map((t) => t.name)).toEqual(['mcp__good__t'])
    expect(describeStatus(m.status)).toEqual(expect.arrayContaining(['remote: unsupported (only stdio servers are supported)', 'bad: failed (spawn ENOENT)', expect.stringContaining('slow: failed (Connecting to MCP server "slow" timed out')]))
    await new Promise((r) => setTimeout(r, 120))
    expect(late.closed).toBe(true) // the late client was shut down, not leaked
  })

  it('tools are never read-only, pass the server schema through and report isError as an error', async () => {
    const m = await McpManager.start({ servers: { s: { command: 'x', args: [], env: {} } }, unsupported: [] }, { cwd: '/', connect: async () => fakeClient(['t'], { callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'nope' }] }) }) })
    const [tool] = m.tools
    expect(tool.readOnly).toBe(false)
    expect(tool.schema).toEqual({ type: 'object', properties: {} })
    await expect(tool.run({}, testCtx('/'))).rejects.toThrow('nope')
  })

  it('runs against a real stdio server and stops its process on close', async () => {
    const m = await McpManager.start({ servers: { fixture: { command: process.execPath, args: [join(__dirname, 'testdata/mcp-server.mjs')], env: {} } }, unsupported: [] }, { cwd: __dirname, timeoutMs: 20_000 })
    try {
      expect(m.tools.map((t) => t.name).sort()).toEqual(['mcp__fixture__echo', 'mcp__fixture__fail', 'mcp__fixture__pic'])
      const byName = (n: string) => m.tools.find((t) => t.name === n)!
      expect(await byName('mcp__fixture__echo').run({ text: 'hi' }, testCtx('/'))).toBe('echo: hi')
      await expect(byName('mcp__fixture__fail').run({}, testCtx('/'))).rejects.toThrow('it broke')
      expect(await byName('mcp__fixture__pic').run({}, testCtx('/'))).toContain('[image: image/png')
    } finally {
      await m.close()
    }
  }, 30_000)
})
