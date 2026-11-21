import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CheckpointStore } from './checkpoints'

const hash = (s: string | Buffer): string => createHash('sha1').update(s).digest('hex')

interface Entry {
  id: number
  files: Map<string, Buffer | null> // path -> original bytes (null = did not exist)
}

/** Checkpoint state shared between a session's FileState and its subagents' forks. */
interface Shared {
  stack: Entry[] // one entry per turn, oldest first
  store?: CheckpointStore
  nextId: number
  chain: Promise<unknown> // serializes disk writes so parallel tool calls cannot interleave
  ready: Promise<unknown> // resolves once attach() has loaded the saved turns
}

export type Scope = 'turn' | 'all'

/** Per-session file bookkeeping: what the model has read (freshness), rewind checkpoints (mirrored to disk when a store is attached), and the persisted Bash cwd. */
export class FileState {
  cwd?: string // set by Bash `cd`; undefined = workspace root
  private reads = new Map<string, { mtimeMs: number; hash: string }>()
  private rewinding = false
  private shared: Shared

  constructor(shared?: Shared) {
    this.shared = shared ?? { stack: [], nextId: 1, chain: Promise.resolve(), ready: Promise.resolve() }
  }

  /** A subagent's view: its own read bookkeeping (it must read before it edits), but the same Bash cwd and the same rewind checkpoints. */
  fork(): FileState {
    const f = new FileState(this.shared)
    f.cwd = this.cwd
    return f
  }

  /** Mirrors checkpoints to `store` and loads the turns it already holds. Returns warnings about damaged checkpoints. */
  attach(store: CheckpointStore): Promise<string[]> {
    const sh = this.shared
    sh.store = store
    const loading = store.load().then(({ turns, warnings }) => {
      sh.stack.unshift(...turns.map((t) => ({ id: t.id, files: t.files })))
      sh.nextId = Math.max(sh.nextId, ...sh.stack.map((e) => e.id + 1))
      return warnings
    })
    sh.ready = loading.catch(() => {})
    return loading.catch((e: Error) => [`Could not read saved checkpoints: ${e.message}`])
  }

  /** Resolves once the saved turns of an attached store have been loaded. */
  async ready(): Promise<void> {
    await this.shared.ready
  }

  private enqueue(job: () => Promise<unknown>): Promise<void> {
    const run = this.shared.chain.then(job)
    this.shared.chain = run.catch(() => {}) // a failing disk must not block edits; the in-memory checkpoint still works
    return run.then(
      () => {},
      () => {}
    )
  }

  private persist(entry: Entry): Promise<void> {
    const sh = this.shared
    return this.enqueue(async () => {
      const evicted = await sh.store?.save({ id: entry.id, files: entry.files })
      if (evicted?.length) sh.stack = sh.stack.filter((e) => !evicted.includes(e.id))
    })
  }

  /** After a compaction the model no longer remembers what it read, so it must read before it edits again. */
  clearReads(): void {
    this.reads.clear()
  }

  markRead(path: string, content: string, mtimeMs: number): void {
    this.reads.set(path, { mtimeMs, hash: hash(content) })
  }

  /** Throws unless the file was read and is unchanged since. Same content with a new mtime (formatters) is still fresh. */
  async assertFresh(path: string, verb: string): Promise<void> {
    const seen = this.reads.get(path)
    if (!seen) throw new Error(`${path} has not been read yet. Read it first, then ${verb} it.`)
    const info = await stat(path)
    if (info.mtimeMs === seen.mtimeMs) return
    if (hash(await readFile(path, 'utf8')) !== seen.hash) throw new Error(`${path} was modified since it was read. Read it again, then ${verb} it.`)
  }

  beginTurn(): void {
    this.shared.stack.push({ id: this.shared.nextId++, files: new Map() })
  }

  /** Call before mutating `path`; only the first touch in a turn is kept. */
  async record(path: string): Promise<void> {
    await this.shared.ready
    const entry = this.shared.stack.at(-1)
    if (!entry || entry.files.has(path)) return
    entry.files.set(path, await readFile(path).catch(() => null))
    await this.persist(entry)
  }

  /** The before-images of the newest turn ('turn') or, per path, the oldest one across all remembered turns ('all'). */
  beforeImages(scope: Scope): Map<string, Buffer | null> {
    const { stack } = this.shared
    if (scope === 'turn') return new Map(stack.at(-1)?.files)
    const out = new Map<string, Buffer | null>()
    for (const entry of stack) for (const [path, bytes] of entry.files) if (!out.has(path)) out.set(path, bytes)
    return out
  }

  private async restore(path: string, bytes: Buffer | null): Promise<void> {
    if (bytes === null) await rm(path, { force: true })
    else {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }
    this.reads.delete(path)
  }

  /** Puts one changed file back to its before-image. False (and nothing touched) when the path is not part of that scope's changes. */
  async revertFile(path: string, scope: Scope): Promise<boolean> {
    await this.shared.ready
    const images = this.beforeImages(scope)
    if (!images.has(path)) return false
    await this.restore(path, images.get(path) ?? null)
    const touched = scope === 'turn' ? this.shared.stack.slice(-1) : this.shared.stack // entries stay (even if empty) so history starts keep lining up
    for (const entry of touched) {
      if (entry.files.delete(path)) await this.persist(entry)
    }
    return true
  }

  /** Undoes the newest turn's file changes. Returns the restored paths, or undefined when there is nothing to rewind. */
  async rewind(): Promise<string[] | undefined> {
    if (this.rewinding) throw new Error('A rewind is already in progress.')
    this.rewinding = true // set before the first await so a second call is rejected, not interleaved
    try {
      await this.shared.ready
      const entry = this.shared.stack.at(-1)
      if (!entry) return undefined
      for (const [path, bytes] of entry.files) await this.restore(path, bytes)
      this.shared.stack.pop() // only after every file was restored, so a failed rewind can be retried
      const { store } = this.shared
      if (store) await this.enqueue(() => store.remove(entry.id))
      return [...entry.files.keys()]
    } finally {
      this.rewinding = false
    }
  }
}
