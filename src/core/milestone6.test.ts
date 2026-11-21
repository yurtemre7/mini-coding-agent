import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../shared/types'
import { runTurn, type Frontend, type TurnOptions } from './agent'
import { FileState } from './filestate'
import { Permissions } from './permissions'
import { FakeProvider } from './provider/fake'
import type { Message, StreamEvent } from './provider/types'
import { builtinTools } from './registry'
import { ExitPlanMode } from './tools/plan'
import { testCtx } from './tools/testutil'
import { TodoWrite } from './tools/todo'
import { createWebFetch, htmlToText } from './tools/web'

const use = (id: string, name: string, input: unknown): StreamEvent => ({ type: 'tool_use', id, name, input })
const stop = (reason: 'end_turn' | 'tool_use'): StreamEvent => ({ type: 'stop', reason })
const say = (t: string): StreamEvent => ({ type: 'text_delta', text: t })

describe('ExitPlanMode', () => {
  const planCtx = (perms: Permissions, allow: boolean, feedback?: string) => ({ ...testCtx('/'), plan: perms, ask: async () => ({ allow, feedback }) })

  it('approving restores the mode the session was in before plan mode', async () => {
    const perms = new Permissions({ mode: 'acceptEdits', canAsk: true })
    perms.mode = 'plan'
    const out = await ExitPlanMode.run({ plan: 'do it' }, planCtx(perms, true))
    expect(perms.mode).toBe('acceptEdits')
    expect(out).toContain('approved')
  })

  it('rejecting keeps plan mode and returns the feedback', async () => {
    const perms = new Permissions({ mode: 'default', canAsk: true })
    perms.mode = 'plan'
    const out = await ExitPlanMode.run({ plan: 'do it' }, planCtx(perms, false, 'use smaller steps'))
    expect(perms.mode).toBe('plan')
    expect(out).toContain('use smaller steps')
  })

  it('errors outside plan mode', async () => {
    const perms = new Permissions({ mode: 'default', canAsk: true })
    await expect(ExitPlanMode.run({ plan: 'x' }, planCtx(perms, true))).rejects.toThrow(/plan mode/)
  })
})

describe('TodoWrite', () => {
  it('emits the list and warns about several in_progress items', async () => {
    const seen: AgentEvent[] = []
    const ctx = { ...testCtx('/'), emit: (e: AgentEvent) => void seen.push(e) }
    const todos = [
      { content: 'a', status: 'in_progress' as const },
      { content: 'b', status: 'in_progress' as const }
    ]
    expect(await TodoWrite.run({ todos }, ctx)).toMatch(/2 items are in_progress/)
    expect(seen).toEqual([{ type: 'todos', todos }])
  })
})

describe('Task subagents', () => {
  function run(turns: ConstructorParameters<typeof FakeProvider>[0], files = new FileState()) {
    const events: AgentEvent[] = []
    const frontend: Frontend = { emit: (e) => void events.push(e), ask: async () => ({ allow: true }) }
    const provider = new FakeProvider(turns)
    const history: Message[] = []
    const opts: TurnOptions = { provider, model: 'm', system: 'sys', tools: builtinTools, cwd: '/', frontend, signal: new AbortController().signal, files }
    return { events, provider, history, go: () => runTurn(history, 'start', opts), files }
  }

  it('runs in its own context, nests events under the Task call and returns only its final text', async () => {
    const s = run([
      [use('t1', 'Task', { description: 'look', prompt: 'find x', subagent_type: 'Explore' }), stop('tool_use')],
      [say('x is in a.ts'), stop('end_turn')], // the subagent
      [say('done'), stop('end_turn')]
    ])
    expect(await s.go()).toBe('done')
    const sub = s.provider.requests[1]
    expect(sub.tools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']) // Explore: read-only tools, no Task
    expect(sub.messages[0].content[0]).toMatchObject({ text: 'find x' }) // no parent history
    expect(s.events).toContainEqual({ type: 'text_delta', text: 'x is in a.ts', parentId: 't1' })
    const result = s.history.flatMap((m) => m.content).find((b) => b.type === 'tool_result')
    expect(result).toMatchObject({ tool_use_id: 't1', content: 'x is in a.ts' })
    expect(s.events.filter((e) => e.type === 'turn_end')).toHaveLength(1) // the subagent does not end the parent's turn
  })

  it('a general-purpose subagent has the write tools but never Task, TodoWrite or ExitPlanMode', async () => {
    const s = run([
      [use('t1', 'Task', { description: 'work', prompt: 'p' }), stop('tool_use')],
      [say('ok'), stop('end_turn')],
      [say('done'), stop('end_turn')]
    ])
    await s.go()
    const names = s.provider.requests[1].tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash', 'WebFetch']))
    for (const n of ['Task', 'TodoWrite', 'ExitPlanMode']) expect(names).not.toContain(n)
  })

  it('a forked FileState has its own reads but shares checkpoints and cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mca-fork-'))
    const file = join(dir, 'f.txt')
    await writeFile(file, 'one')
    const parent = new FileState()
    parent.cwd = dir
    const child = parent.fork()
    expect(child.cwd).toBe(dir)
    parent.markRead(file, 'one', (await stat(file)).mtimeMs)
    await expect(child.assertFresh(file, 'edit')).rejects.toThrow(/not been read/) // reads are not shared
    child.beginTurn()
    await child.record(file) // a checkpoint taken by the child ...
    await writeFile(file, 'two')
    expect(await parent.rewind()).toEqual([file]) // ... is rewound by the parent
    expect(await readFile(file, 'utf8')).toBe('one')
  })
})

describe('WebFetch', () => {
  let server: Server
  let base: string
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/page') res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><title>t</title></head><body><script>x()</script><p>Hello &amp; welcome</p></body></html>')
      else if (req.url === '/same') res.writeHead(302, { location: '/page' }).end()
      else if (req.url === '/cross') res.writeHead(302, { location: 'http://other.invalid/x' }).end()
      else if (req.url === '/big') res.writeHead(200, { 'content-type': 'text/plain' }).end(Buffer.alloc(6 * 1024 * 1024, 'a'))
      else if (req.url === '/bin') res.writeHead(200, { 'content-type': 'application/octet-stream' }).end('xx')
      else res.writeHead(404).end('nope')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => void server.close())

  const fetchTool = () => createWebFetch({ upgradeHttp: false })
  const get = (path: string) => fetchTool().run({ url: base + path, prompt: 'p' }, testCtx('/'))

  it('converts html to text', async () => {
    const out = await get('/page')
    expect(out).toContain('Hello & welcome')
    expect(out).not.toContain('x()')
  })

  it('follows same-host redirects', async () => {
    expect(await get('/same')).toContain('Hello & welcome')
  })

  it('hands a cross-host redirect back instead of following it', async () => {
    expect(await get('/cross')).toContain('http://other.invalid/x')
  })

  it('rejects oversized and non-text responses and HTTP errors', async () => {
    await expect(get('/big')).rejects.toThrow()
    await expect(get('/bin')).rejects.toThrow()
    await expect(get('/missing')).rejects.toThrow(/404/)
  })

  it('htmlToText drops scripts and decodes entities', () => {
    expect(htmlToText('<style>a{}</style><p>a&lt;b</p><p>c</p>')).toBe('a<b\nc')
  })
})
