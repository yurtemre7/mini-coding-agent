// A tiny MCP stdio server for tests: one tool that echoes, one that fails, one that returns an image.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'fixture', version: '1.0.0' })
server.registerTool('echo', { description: 'Echo the text', inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }))
server.registerTool('fail', { description: 'Always fails' }, async () => ({ isError: true, content: [{ type: 'text', text: 'it broke' }] }))
server.registerTool('pic', { description: 'Returns an image' }, async () => ({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }))
await server.connect(new StdioServerTransport())
