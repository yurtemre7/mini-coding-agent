import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../core/provider/fake'
import { ProviderError } from '../core/provider/retry'
import type { StreamEvent } from '../core/provider/types'
import { applyBatch } from '../shared/reducer'
import type { EventBatch, ProviderId, TerminalEvent, ViewEvent, ViewState } from '../shared/types'
import { createBatcher } from './batcher'
import { Controller } from './controller'

const write = (p: string): StreamEvent[] => [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: p, content: 'hi' } }, { type: 'stop', reason: 'tool_use' }]
const say: StreamEvent[] = [{ type: 'text_delta', text: 'done' }, { type: 'stop', reason: 'end_turn' }]

async function setup(turns: ConstructorParameters<typeof FakeProvider>[0], hasKey = true, extra: Partial<ConstructorParameters<typeof Controller>[0]> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'mca-home-'))
  const ws = await mkdtemp(join(tmpdir(), 'mca-ws-'))
  const events: ViewEvent[] = []
  const prompts: { id: string }[] = []
  const store: Partial<Record<ProviderId, string>> = hasKey ? { anthropic: 'k' } : {}
  const c = new Controller({
    home,
    emit: (e) => void events.push(e),
    prompt: (p) => prompts.push(p),
    keys: { get: async (p) => store[p] ?? null, set: async (p, k) => void (store[p] = k) },
    makeProvider: () => new FakeProvider(turns),
    ...extra
  })
  await c.selectWorkspace(ws)
  const idle = async () => { while (c.getState().busy || events.at(-1)?.type !== 'turn_end') await new Promise((r) => setTimeout(r, 5)) }
  return { c, ws, events, prompts, idle, store }
}

describe('Controller', () => {
  it('runs a turn, routes a permission prompt to the renderer, and Yes lets the tool run', async () => {
    const { c, ws, events, prompts, idle } = await setup([[]])
    const file = join(ws, 'a.txt')
    ;(c as any).d.makeProvider = () => new FakeProvider([write(file), say])
    c.send('write it')
    while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().pending?.id).toBe(prompts[0].id)
    await expect(c.selectWorkspace(ws)).rejects.toThrow(/while a turn is running/)
    c.answer(prompts[0].id, { allow: true, scope: 'once' })
    await idle()
    expect(await readFile(file, 'utf8')).toBe('hi')
    expect(c.getState()).toMatchObject({ busy: false, pending: null })
    expect(c.getState().items.map((i) => i.kind)).toEqual(['user', 'tool', 'text'])
    expect(events.some((e) => e.type === 'turn_end')).toBe(true)
  })
  it('abort during a prompt denies it and ends the turn; a stale answer is ignored', async () => {
    const { c, ws, prompts, idle } = await setup([[]])
    ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'b.txt')), say])
    c.send('go')
    while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
    c.abort()
    await idle()
    expect(c.getState().pending).toBeNull()
    expect(() => c.answer(prompts[0].id, { allow: true })).toThrow() // already gone
    await expect(readFile(join(ws, 'b.txt'), 'utf8')).rejects.toThrow()
  })
  it('settings never expose a key; provider/model changes are blocked mid-turn', async () => {
    const { c, store } = await setup([[]], false)
    expect((await c.getSettings()).effort).toBe('medium')
    expect((await c.update({ effort: 'high' })).effort).toBe('high')
    expect((await c.getSettings()).hasKey).toEqual({ anthropic: false, openrouter: false })
    const after = await c.setKey('anthropic', ' secret ')
    expect(store.anthropic).toBe('secret')
    expect(JSON.stringify(after)).not.toContain('secret')
    expect(after.hasKey.anthropic).toBe(true)
    await expect(c.setKey('anthropic', '  ')).rejects.toThrow()
    expect((await c.update({ provider: 'openrouter' })).model).toMatch(/\//)
  })
  it('models: caches the list per provider; a rejected key falls back to defaults with the reason', async () => {
    let calls = 0
    const home = await mkdtemp(join(tmpdir(), 'mca-home-'))
    const listed = new FakeProvider([])
    listed.listModels = async () => (calls++, [{ id: 'm1' }, { id: 'm2', free: true }])
    const c = new Controller({ home, emit: () => {}, prompt: () => {}, keys: { get: async (p) => (p === 'anthropic' ? 'k' : null), set: async () => {}, source: async () => 'env' }, makeProvider: () => listed })
    expect(await c.models('anthropic')).toEqual({ models: [{ id: 'm1' }, { id: 'm2', free: true }] })
    await c.models('anthropic')
    expect(calls).toBe(1)
    expect((await c.getSettings()).keySource).toEqual({ anthropic: 'env', openrouter: null })
    const none = await c.models('openrouter')
    expect(none.error).toMatch(/No API key/)
    const denied = new FakeProvider([])
    denied.listModels = async () => { throw new ProviderError('Authentication failed', 401) }
    const c2 = new Controller({ home, emit: () => {}, prompt: () => {}, keys: { get: async () => 'k', set: async () => {} }, makeProvider: () => denied })
    const r = await c2.models('anthropic')
    expect(r).toMatchObject({ rejected: true, error: 'Authentication failed' })
    expect(r.models).toEqual([{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }])
  })
  it('/mode and unknown commands report through notices', async () => {
    const { c } = await setup([[]])
    await c.command('/mode plan')
    expect(c.getState().mode).toBe('plan')
    await c.command('/nope')
    expect(c.getState().items.at(-1)).toMatchObject({ kind: 'notice', level: 'error' })
    await c.command('/exit') // CLI-only: not exposed to the renderer
    expect(c.getState().items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', message: expect.stringContaining('/exit') })
  })
  it('/trust asks through the trust prompt and trusts only on yes', async () => {
    const { c, prompts, ws } = await setup([[]])
    const done = c.command('/trust')
    while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
    expect(c.getState().pending?.request).toMatchObject({ kind: 'trust', workspace: ws })
    c.answer(prompts[0].id, { allow: false })
    await done
    expect(c.getState().items.at(-1)).toMatchObject({ message: 'Workspace not trusted.' })
  })
  it('saves chats, lists them, reopens one with its items and rejects unknown ids; only recent workspaces reopen', async () => {
    const { c, ws, idle } = await setup([[]])
    ;(c as any).d.makeProvider = () => new FakeProvider([say, say])
    c.send('hello world')
    await idle()
    c.newChat()
    expect(c.getState().items).toEqual([])
    c.send('second')
    await idle()
    const chats = c.chats()
    expect(chats.map((x) => x.title).sort()).toEqual(['hello world', 'second'])
    c.openChat(chats.find((x) => x.title === 'hello world')!.id)
    expect(c.getState().items).toEqual([{ kind: 'user', text: 'hello world' }, { kind: 'text', text: 'done' }])
    expect(() => c.openChat('nope')).toThrow(/Unknown chat/)
    await expect(c.openRecent('/etc')).rejects.toThrow(/Unknown workspace/)
    expect(await c.recent()).toContain(ws)
    await c.openRecent(ws)
    expect(c.getState().items).toEqual([{ kind: 'user', text: 'second' }, { kind: 'text', text: 'done' }]) // a workspace switch continues the newest saved chat
  })
  it('forgetting a recent workspace removes only the list entry; the open one and unknown paths are refused', async () => {
    const { c, ws } = await setup([[]])
    const other = await mkdtemp(join(tmpdir(), 'mca-ws2-'))
    await c.selectWorkspace(other)
    expect(await c.recent()).toEqual(expect.arrayContaining([ws, other]))
    await expect(c.forgetRecent(other)).rejects.toThrow(/in use/)
    await expect(c.forgetRecent('/etc')).rejects.toThrow(/Unknown workspace/)
    await c.forgetRecent(ws)
    expect(await c.recent()).toEqual([other])
    expect((await stat(ws)).isDirectory()).toBe(true) // the folder itself is still there
  })
  it('lists every workspace with its chats in the saved order, and saves a new order', async () => {
    const { c, ws, idle } = await setup([[]])
    ;(c as any).d.makeProvider = () => new FakeProvider([say])
    c.send('in the first workspace')
    await idle()
    const other = await mkdtemp(join(tmpdir(), 'mca-ws2-'))
    await c.selectWorkspace(other)
    expect((await c.overview()).map((w) => w.path)).toEqual([other, ws])
    expect((await c.overview()).find((w) => w.path === ws)!.chats.map((x) => x.title)).toEqual(['in the first workspace'])
    await c.reorderRecent([ws, other, '/etc'])
    expect((await c.overview()).map((w) => w.path)).toEqual([ws, other])
  })
  describe('chat management and instructions', () => {
    it('deletes a chat (replacing the open one) and exports a chat as Markdown', async () => {
      const { c, idle } = await setup([say])
      c.send('first question')
      await idle()
      const [chat] = c.chats()
      const exp = c.exportChat(chat.id)
      expect(exp.markdown).toContain('# first question')
      expect(exp.markdown).toContain('## MCA\n\ndone')
      c.deleteChat(chat.id)
      expect(c.chats()).toEqual([])
      expect(c.getState().items).toEqual([])
      expect(() => c.deleteChat(chat.id)).toThrow(/Unknown chat/)
      expect(() => c.exportChat(chat.id)).toThrow(/Unknown chat/)
    })
    it('renames a chat, keeps its position in the list, and rejects bad input', async () => {
      const { c, idle } = await setup([say])
      c.send('first question')
      await idle()
      const [chat] = c.chats()
      c.renameChat(chat.id, '  My   plan \n')
      const [after] = c.chats()
      expect(after).toMatchObject({ id: chat.id, title: 'My plan', messageCount: chat.messageCount })
      expect(Math.abs(after.updated - chat.updated)).toBeLessThan(5) // timestamp kept (the filesystem rounds it)
      expect(c.exportChat(chat.id).markdown).toContain('# My plan')
      expect(() => c.renameChat(chat.id, '   ')).toThrow(/empty/)
      expect(() => c.renameChat('nope', 'x')).toThrow(/Unknown chat/)
    })
    it('refuses to delete a chat while a turn runs', async () => {
      const { c, ws, prompts, idle } = await setup([[]])
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'z.txt')), say])
      c.send('go')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      expect(() => c.deleteChat('whatever')).toThrow(/while a turn is running/)
      c.abort()
      await idle()
    })
    it('appends custom instructions, or replaces the built-in prompt, and remembers them', async () => {
      const fake = new FakeProvider([say, say])
      const { c, idle, ws } = await setup([[]], true, { makeProvider: () => fake })
      c.send('hi')
      await idle()
      const base = fake.requests[0].system
      expect(base).toMatch(/You are MCA/)
      expect((await c.update({ systemPrompt: 'Answer in German.' })).systemPrompt).toBe('Answer in German.')
      c.send('again')
      await idle()
      expect(fake.requests.at(-1)!.system).toBe(`${base}\n\nAnswer in German.`)
      await c.update({ systemReplace: true })
      c.send('third')
      while (fake.requests.length < 3) await new Promise((r) => setTimeout(r, 5))
      expect(fake.requests.at(-1)!.system).toBe('Answer in German.')
      const home = (c as any).d.home
      const c2 = new Controller({ home, emit: () => {}, prompt: () => {}, keys: { get: async () => 'k', set: async () => {} } })
      await c2.init()
      expect(await c2.getSettings()).toMatchObject({ systemPrompt: 'Answer in German.', systemReplace: true })
      void ws
    })
  })

  describe('git and terminal', () => {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
    it('is empty without a workspace and works on the open one', async () => {
      const { c, ws } = await setup([[]])
      git(ws, 'init', '-q', '-b', 'main')
      await writeFile(join(ws, 'f.txt'), 'hi\n')
      expect((await c.gitStatus()).files.map((f) => f.path)).toEqual(['f.txt'])
      await c.gitStage(['f.txt'], true)
      git(ws, 'config', 'user.email', 't@t')
      git(ws, 'config', 'user.name', 't')
      git(ws, 'config', 'commit.gpgsign', 'false')
      expect(await c.gitCommit('add f')).toMatch(/^[0-9a-f]+$/)
      await c.gitSwitch('topic', true)
      expect((await c.gitBranches()).current).toBe('topic')
      const none = new Controller({ home: await mkdtemp(join(tmpdir(), 'mca-home-')), emit: () => {}, prompt: () => {}, keys: { get: async () => null, set: async () => {} } })
      expect((await none.gitStatus()).repo).toBe(false)
      expect(await none.workspaceFiles()).toEqual([])
      expect(await c.workspaceFiles()).toContain('f.txt')
      expect(() => none.terminalRun('ls')).toThrow(/Open a workspace/)
    })
    it('blocks commit, push and branch switches while a turn runs', async () => {
      const { c, ws, prompts, idle } = await setup([[]])
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'q.txt')), say])
      c.send('go')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      expect(() => c.gitCommit('x')).toThrow(/while a turn is running/)
      expect(() => c.gitPush()).toThrow(/while a turn is running/)
      expect(() => c.gitSwitch('b', true)).toThrow(/while a turn is running/)
      c.abort()
      await idle()
    })
    it('streams terminal output to the frontend', async () => {
      const out: TerminalEvent[] = []
      const { c } = await setup([[]], true, { terminal: (e) => void out.push(e) })
      c.terminalRun('echo from-terminal')
      while (!out.some((e) => e.type === 'exit')) await new Promise((r) => setTimeout(r, 5))
      expect(out.some((e) => e.type === 'out' && e.text.includes('from-terminal'))).toBe(true)
    })
  })

  describe('notifications', () => {
    const loopTurns = () => { const same: StreamEvent[] = [{ type: 'tool_use', id: 'g', name: 'Glob', input: { pattern: '*.nothing' } }, { type: 'stop', reason: 'tool_use' }]; return [same, same, same, say] }
    it('tells the user when the model looks stuck in a loop', async () => {
      const sent: string[] = []
      const { c, idle } = await setup([[]], true, { notify: (m) => void sent.push(m) })
      ;(c as any).d.makeProvider = () => new FakeProvider(loopTurns())
      await c.command('/mode bypassPermissions')
      c.send('go')
      await idle()
      expect(sent).toEqual(['MCA may be stuck in a loop.', 'MCA finished the task.'])
    })
    it('the Notifications setting silences them, is remembered across launches and can change during a turn', async () => {
      const sent: string[] = []
      const { c, ws, prompts, idle } = await setup([[]], true, { notify: (m) => void sent.push(m), timings: { promptMs: 20 } })
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'q.txt')), say])
      expect((await c.getSettings()).notifications).toBe(true)
      c.send('go')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      expect((await c.update({ notifications: false })).notifications).toBe(false) // mid-turn: allowed
      await new Promise((r) => setTimeout(r, 50))
      expect(sent).toEqual([])
      c.abort()
      await idle()
      const c2 = new Controller({ home: (c as any).d.home, emit: () => {}, prompt: () => {}, keys: { get: async () => 'k', set: async () => {} } })
      await c2.init()
      expect((await c2.getSettings()).notifications).toBe(false)
    })
    it('notifies when the task finishes, and not once notifications are switched off', async () => {
      const sent: string[] = []
      const { c, idle } = await setup([say, say], true, { notify: (m) => void sent.push(m) })
      c.send('one')
      await idle()
      expect(sent).toEqual(['MCA finished the task.'])
      await c.update({ notifications: false })
      c.send('two')
      await idle()
      expect(sent).toEqual(['MCA finished the task.'])
    })
    it('notifies when a prompt waits too long, but not when it is answered in time', async () => {
      const sent: string[] = []
      const { c, ws, prompts, idle } = await setup([[]], true, { notify: (m) => void sent.push(m), timings: { promptMs: 30 } })
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'n.txt')), say, write(join(ws, 'm.txt')), say])
      c.send('one')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      c.answer(prompts[0].id, { allow: true, scope: 'once' }) // in time
      await idle()
      await new Promise((r) => setTimeout(r, 60))
      expect(sent).toEqual(['MCA finished the task.']) // answered in time: no waiting notification
      sent.length = 0
      c.send('two')
      while (prompts.length < 2) await new Promise((r) => setTimeout(r, 5))
      await new Promise((r) => setTimeout(r, 60)) // left waiting
      expect(sent).toEqual(['MCA is waiting for your approval.'])
      c.abort()
      await idle()
      expect(sent).toEqual(['MCA is waiting for your approval.']) // an aborted turn is not "finished"
    })
    it('notifies once when a turn runs long, and never after it ended', async () => {
      const sent: string[] = []
      const { c, ws, prompts, idle } = await setup([[]], true, { notify: (m) => void sent.push(m), timings: { longTurnMs: 30, promptMs: 10_000 } })
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'l.txt')), say])
      c.send('slow')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      await new Promise((r) => setTimeout(r, 60))
      expect(sent).toEqual(['MCA is still working on your request.'])
      c.answer(prompts[0].id, { allow: true, scope: 'once' })
      await idle()
      await new Promise((r) => setTimeout(r, 60))
      expect(sent).toEqual(['MCA is still working on your request.', 'MCA finished the task.']) // nothing after the end
    })
  })
  it('/resume lists saved chats newest first and opens one by number or id; bad arguments say so', async () => {
    const { c, idle } = await setup([[]])
    ;(c as any).d.makeProvider = () => new FakeProvider([say, say])
    await c.command('/resume')
    expect(c.getState().items.at(-1)).toMatchObject({ message: 'No saved chats in this workspace yet.' })
    c.send('first chat')
    await idle()
    c.newChat()
    c.send('second chat')
    await idle()
    await c.command('/resume')
    const list = (c.getState().items.at(-1) as any).message as string
    expect(list.indexOf('second chat')).toBeLessThan(list.indexOf('first chat'))
    await c.command('/resume 2')
    expect(c.getState().items[0]).toEqual({ kind: 'user', text: 'first chat' })
    await c.command('/resume 9')
    expect(c.getState().items.at(-1)).toMatchObject({ message: expect.stringMatching(/No chat matches/) })
  })
  it('remembers provider, model and effort and reopens the last workspace on launch', async () => {
    const { c, ws, store } = await setup([[]])
    await c.update({ model: 'my-model', effort: 'max' })
    const home = (c as any).d.home
    const c2 = new Controller({ home, emit: () => {}, prompt: () => {}, keys: { get: async (p) => store[p] ?? null, set: async () => {} } })
    await c2.init()
    expect(await c2.getSettings()).toMatchObject({ provider: 'anthropic', model: 'my-model', effort: 'max' })
    await c2.openLast()
    expect(c2.getState().workspace).toBe(ws)
  })
  it('answering with an id that is not pending is rejected', async () => {
    const { c } = await setup([[]])
    expect(() => c.answer('nope', { allow: true })).toThrow(/No matching prompt/)
  })
})

describe('main -> batcher -> renderer apply', () => {
  it('send and /rewind never double-apply, even when a snapshot lands mid-stream', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mca-home-'))
    const ws = await mkdtemp(join(tmpdir(), 'mca-ws-'))
    let view: ViewState | undefined // the renderer's state
    const old: EventBatch[] = []
    const b = createBatcher((batch) => (old.push(batch), (view = view && applyBatch(view, batch))), 1000)
    const c = new Controller({
      home,
      emit: (e, seq) => b.push(e, seq),
      prompt: () => {},
      keys: { get: async () => 'k', set: async () => {} },
      makeProvider: () => new FakeProvider([say, say])
    })
    const snapshot = () => (b.flush(), (view = c.getState())) // what session:getState does
    const idle = async () => { while (c.getState().busy) await new Promise((r) => setTimeout(r, 5)); b.flush() }
    await c.selectWorkspace(ws)
    snapshot()
    c.send('one')
    await idle()
    snapshot() // mounted mid-session
    const turns = () => view!.items.filter((i) => i.kind === 'user').length
    expect(turns()).toBe(1)
    for (const stale of old) expect(applyBatch(view!, stale)).toBe(view) // batches the snapshot already includes are ignored
    c.send('two')
    await idle()
    expect(view!.items).toEqual(c.getState().items)
    await c.command('/rewind') // nothing to restore for a text-only turn: history still drops one turn
    b.flush()
    expect(view!.items).toEqual(c.getState().items)
    expect(turns()).toBe(1)
  })
  describe('changes', () => {
    const turnWithWrite = async () => {
      const t = await setup([[]])
      const file = join(t.ws, 'a.txt')
      ;(t.c as any).d.makeProvider = () => new FakeProvider([write(file), say])
      t.c.send('write it')
      while (!t.prompts.length) await new Promise((r) => setTimeout(r, 5))
      t.c.answer(t.prompts[0].id, { allow: true, scope: 'once' })
      await t.idle()
      return { ...t, file }
    }
    it('a turn reports its changes; changeDiff returns the patch and refuses unknown files', async () => {
      const { c } = await turnWithWrite()
      expect(c.getState().changes.turn).toMatchObject([{ path: 'a.txt', status: 'added', additions: 1 }])
      expect(await c.changeDiff('turn', 'a.txt')).toContain('+hi')
      await expect(c.changeDiff('turn', 'nope.txt')).rejects.toThrow(/Unknown changed file/)
      await expect(c.changeDiff('turn', '../../etc/passwd')).rejects.toThrow(/Unknown changed file/)
    })
    it('changeRevert removes a created file and refreshes the list; unknown paths touch nothing', async () => {
      const { c, ws, file } = await turnWithWrite()
      await expect(c.changeRevert('turn', '../outside.txt')).rejects.toThrow(/Unknown changed file/)
      await c.changeRevert('turn', 'a.txt')
      await expect(readFile(file, 'utf8')).rejects.toThrow()
      expect(c.getState().changes).toEqual({ turn: [], total: [] })
      expect(ws).toBeTruthy()
    })
    it('changeRevert is refused while a turn is running', async () => {
      const { c, ws, prompts } = await setup([[]])
      ;(c as any).d.makeProvider = () => new FakeProvider([write(join(ws, 'b.txt')), say])
      c.send('go')
      while (!prompts.length) await new Promise((r) => setTimeout(r, 5))
      await expect(c.changeRevert('turn', 'b.txt')).rejects.toThrow(/while a turn is running/)
      c.abort()
    })
  })
  it('lists skills with their state and persists a switch', async () => {
    const { c, ws } = await setup([[]])
    await mkdir(join(ws, '.mca', 'skills', 'ponytail'), { recursive: true })
    await writeFile(join(ws, '.mca', 'skills', 'ponytail', 'SKILL.md'), '---\ndescription: ride\n---\nbody')
    expect(await c.skillList()).toMatchObject([{ name: 'ponytail', source: 'project', enabled: true }])
    expect(await c.setSkill('ponytail', false)).toMatchObject([{ name: 'ponytail', enabled: false }])
    expect((await c.commandList()).map((x) => x.name)).not.toContain('ponytail')
    expect(await c.setSkill('ponytail', true)).toMatchObject([{ enabled: true }])
    expect((await c.commandList()).map((x) => x.name)).toContain('ponytail')
  })
})
