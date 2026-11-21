import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sealHistory } from './agent'
import type { Message } from './provider/types'
import { isReminder } from '../shared/types'

const VERSION = 1
export interface SessionMeta {
  provider: string
  model: string
}
export interface SessionInfo {
  id: string
  title: string
  updated: number // ms since epoch
  messageCount: number
}
type Meta = SessionMeta & { type: 'meta'; version: number; cwd: string; created: string; title: string }
type Rec = Meta | ({ type: 'message' } & Message) | { type: 'rewind'; length: number }

/** Ids are our own UUIDs; anything else (a renderer or CLI argument) never reaches the filesystem. */
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(s)

/** ~/.mca/projects/<cwd with separators replaced>-<8-char hash>: the hash keeps "/a/b-c" and "/a-b/c" apart. */
export function sessionDir(cwd: string, home = homedir()): string {
  const abs = resolve(cwd)
  return join(home, '.mca', 'projects', `${abs.replace(/[\\/:]/g, '-')}-${createHash('sha256').update(abs).digest('hex').slice(0, 8)}`)
}

const titleOf = (m: Message): string =>
  m.content.flatMap((b) => (b.type === 'text' && !isReminder(b.text) ? [b.text] : [])).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/** Tolerant parse: unparseable lines (a crash mid-write) are skipped, an unknown version is refused. `damaged` = something was skipped or repaired. */
export function parseTranscript(text: string): { meta: Meta; messages: Message[]; damaged: boolean } {
  let meta: Meta | undefined
  const messages: Message[] = []
  let damaged = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let r: Rec
    try {
      r = JSON.parse(line)
    } catch {
      damaged = true
      continue
    }
    if (r?.type === 'meta') {
      if (r.version !== VERSION) throw new Error(`Unsupported session version ${String(r.version)} (this MCA reads version ${VERSION}). Update MCA to open it.`)
      meta ??= r
    } else if (r?.type === 'message' && (r.role === 'user' || r.role === 'assistant') && Array.isArray(r.content)) messages.push({ role: r.role, content: r.content })
    else if (r?.type === 'rewind' && Number.isInteger(r.length) && r.length >= 0) messages.length = Math.min(messages.length, r.length)
    else damaged = true
  }
  if (!meta) throw new Error('Not an MCA session file (no meta record).')
  const before = JSON.stringify(messages)
  sealHistory(messages)
  return { meta, messages, damaged: damaged || JSON.stringify(messages) !== before }
}

/** One JSONL file per session, created (mode 0600) on the first message so empty chats leave nothing behind. */
export class Transcript {
  readonly id: string
  private started: boolean
  constructor(
    readonly cwd: string,
    private meta: () => SessionMeta,
    private o: { home?: string; id?: string; started?: boolean } = {}
  ) {
    this.id = o.id ?? randomUUID()
    this.started = !!o.started
  }

  get path(): string {
    return join(sessionDir(this.cwd, this.o.home), `${this.id}.jsonl`)
  }

  private write(r: Rec): void {
    if (!this.started) {
      mkdirSync(sessionDir(this.cwd, this.o.home), { recursive: true })
      appendFileSync(this.path, JSON.stringify({ type: 'meta', version: VERSION, cwd: resolve(this.cwd), ...this.meta(), created: new Date().toISOString(), title: r.type === 'message' ? titleOf(r) : '' }) + '\n', { mode: 0o600 })
      this.started = true
    }
    appendFileSync(this.path, JSON.stringify(r) + '\n')
  }

  /** One complete message, never a delta. */
  append(m: Message): void {
    this.write({ type: 'message', role: m.role, content: m.content })
  }

  /** /rewind: the history is now `length` messages long. */
  rewind(length: number): void {
    if (this.started) this.write({ type: 'rewind', length })
  }

  /** A new session file in the same workspace (/clear, New chat). */
  fresh(): Transcript {
    return new Transcript(this.cwd, this.meta, { home: this.o.home })
  }
}

export function loadSession(cwd: string, id: string, meta: () => SessionMeta, home?: string): { transcript: Transcript; messages: Message[] } {
  const path = join(sessionDir(cwd, home), `${id}.jsonl`)
  const { messages, damaged, meta: m } = parseTranscript(readFileSync(path, 'utf8'))
  if (damaged) {
    // fold skipped lines, rewinds and repairs into a clean file, so later appends never land after a half-written line
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, [m, ...messages.map((x) => ({ type: 'message', ...x }))].map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
    copyFileSync(path, `${path}.bak`) // keep the damaged original next to it; nothing unreadable is lost for good
    renameSync(tmp, path)
  }
  return { transcript: new Transcript(cwd, meta, { home, id, started: true }), messages }
}

/** Newest first. shortcut: parses every transcript in the workspace dir, upgrade to reading just the head if lists get slow. */
export function listSessions(cwd: string, home?: string): SessionInfo[] {
  const dir = sessionDir(cwd, home)
  if (!existsSync(dir)) return []
  const out: SessionInfo[] = []
  for (const f of readdirSync(dir)) {
    const id = f.slice(0, -'.jsonl'.length)
    if (!f.endsWith('.jsonl') || !isSessionId(id)) continue
    try {
      const { meta, messages } = parseTranscript(readFileSync(join(dir, f), 'utf8'))
      out.push({ id, title: meta.title || '(untitled)', updated: statSync(join(dir, f)).mtimeMs, messageCount: messages.length })
    } catch {
      // unreadable or newer-version file: not listed
    }
  }
  return out.sort((a, b) => b.updated - a.updated)
}

/** --continue / --resume <id> / neither. Unknown or missing sessions start a new one and say so in `note`. */
export function startSession(cwd: string, meta: () => SessionMeta, o: { continue?: boolean; resume?: string; home?: string } = {}): { transcript: Transcript; messages: Message[]; note?: string } {
  const fresh = (note?: string) => ({ transcript: new Transcript(cwd, meta, { home: o.home }), messages: [] as Message[], note })
  if (!o.continue && o.resume === undefined) return fresh()
  const id = o.resume ?? listSessions(cwd, o.home)[0]?.id
  if (!id) return fresh('No saved sessions for this directory; starting a new one.')
  if (!isSessionId(id) || !existsSync(join(sessionDir(cwd, o.home), `${id}.jsonl`))) return fresh(`Session "${id}" not found for this directory; starting a new one.`)
  const { transcript, messages } = loadSession(cwd, id, meta, o.home)
  return { transcript, messages, note: `Resumed session ${id} (${messages.length} messages).` }
}
