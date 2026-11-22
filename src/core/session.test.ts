import { appendFileSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentSession } from './agent'
import { FakeProvider } from './provider/fake'
import type { Message } from './provider/types'
import { listSessions, loadSession, sessionDir, startSession, Transcript } from './session'
import { builtinTools } from './registry'

const tmp = () => mkdtempSync(join(tmpdir(), 'mca-sess-'))
const meta = () => ({ provider: 'fake', model: 'm' })
const user = (t: string): Message => ({ role: 'user', content: [{ type: 'text', text: t }] })

describe('session transcripts', () => {
  it('writes meta first (title = first prompt, 80 chars), one line per message, mode 0600', () => {
    const home = tmp()
    const t = new Transcript('/w', meta, { home })
    t.append(user('x'.repeat(100)))
    t.append({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] })
    const lines = readFileSync(t.path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.type)).toEqual(['meta', 'message', 'message'])
    expect(lines[0]).toMatchObject({ version: 1, cwd: resolve('/w'), provider: 'fake', model: 'm', title: 'x'.repeat(80) })
    if (process.platform !== 'win32') expect(statSync(t.path).mode & 0o777).toBe(0o600) // Windows has no POSIX modes
  })
  it('two cwds that sanitize alike get different directories', () => {
    expect(sessionDir('/a/b-c', '/h')).not.toBe(sessionDir('/a-b/c', '/h'))
    expect(sessionDir('/a/b', '/h').replace(/\\/g, '/')).toMatch(/\.mca\/projects\/(?:[A-Z]-)?-a-b-[0-9a-f]{8}$/)
  })
  it('resumes through a truncated last line and a dangling tool_use, then keeps appending cleanly', () => {
    const home = tmp()
    const t = new Transcript('/w', meta, { home })
    t.append(user('go'))
    t.append({ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] })
    appendFileSync(t.path, '{"type":"message","role":"user","content":[{"type":"te') // crash mid-write
    const { messages, transcript } = loadSession('/w', t.id, meta, home)
    expect(messages).toHaveLength(3)
    expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'a', is_error: true })
    transcript.append(user('next'))
    const again = loadSession('/w', t.id, meta, home).messages
    expect(again).toHaveLength(4)
    expect(JSON.stringify(again[3])).toContain('next')
    if (process.platform !== 'win32') expect(statSync(t.path).mode & 0o777).toBe(0o600) // Windows has no POSIX modes
  })
  it('refuses an unknown version with a clear message', () => {
    const home = tmp()
    const t = new Transcript('/w', meta, { home })
    t.append(user('hi'))
    writeFileSync(t.path, readFileSync(t.path, 'utf8').replace('"version":1', '"version":99'))
    expect(() => loadSession('/w', t.id, meta, home)).toThrow(/Unsupported session version 99/)
    expect(listSessions('/w', home)).toEqual([]) // not listed either
  })
  it('/rewind records survive a reload; /clear starts a new file', () => {
    const home = tmp()
    const t = new Transcript('/w', meta, { home })
    for (const m of [user('a'), { role: 'assistant', content: [{ type: 'text', text: 'A' }] } as Message, user('b')]) t.append(m)
    t.rewind(2)
    expect(loadSession('/w', t.id, meta, home).messages).toHaveLength(2)
    expect(t.fresh().id).not.toBe(t.id)
    expect(readdirSync(sessionDir('/w', home))).toHaveLength(1) // the fresh one has no file until its first message
  })
  it('--continue picks the newest and says when there is none; --resume with an unknown or hostile id starts new', async () => {
    const home = tmp()
    expect(startSession('/w', meta, { continue: true, home }).note).toMatch(/No saved sessions/)
    const a = new Transcript('/w', meta, { home })
    a.append(user('old'))
    await new Promise((r) => setTimeout(r, 20))
    const b = new Transcript('/w', meta, { home })
    b.append(user('new'))
    const s = startSession('/w', meta, { continue: true, home })
    expect(s.transcript.id).toBe(b.id)
    expect(listSessions('/w', home).map((x) => x.title)).toEqual(['new', 'old'])
    expect(startSession('/w', meta, { resume: a.id, home }).messages).toHaveLength(1)
    for (const id of ['nope', '../../etc/passwd']) {
      const r = startSession('/w', meta, { resume: id, home })
      expect(r.note).toMatch(/not found/)
      expect(r.messages).toEqual([])
    }
  })
  it('AgentSession saves each finished message, including the sealed result of an aborted tool turn', async () => {
    const home = tmp()
    const provider = new FakeProvider([
      [{ type: 'text_delta', text: 'hi' }, { type: 'tool_use', id: 'r', name: 'Glob', input: { pattern: '*' } }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'done' }, { type: 'stop', reason: 'end_turn' }]
    ])
    const s = new AgentSession({ provider, model: 'm', system: 's', tools: builtinTools, cwd: home, frontend: { emit: () => {}, ask: async () => ({ allow: true }) } })
    s.store = new Transcript(home, meta, { home })
    await s.send('list')
    const saved = loadSession(home, s.store.id, meta, home).messages
    expect(saved).toEqual(s.history)
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const first = s.store.id
    s.clear()
    expect(s.store.id).not.toBe(first)
  })
})
