import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const hash = (s: string | Buffer): string => createHash('sha1').update(s).digest('hex')

/** Per-session file bookkeeping: what the model has read (freshness), rewind checkpoints, and the persisted Bash cwd. */
export class FileState {
  cwd?: string // set by Bash `cd`; undefined = workspace root
  private reads = new Map<string, { mtimeMs: number; hash: string }>()
  private rewinding = false
  private stack: Map<string, Buffer | null>[] = [] // one entry per turn: path -> original bytes (null = did not exist)

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
    this.stack.push(new Map())
  }

  /** Call before mutating `path`; only the first touch in a turn is kept. */
  async record(path: string): Promise<void> {
    const entry = this.stack.at(-1)
    if (!entry || entry.has(path)) return
    entry.set(path, await readFile(path).catch(() => null))
  }

  /** Undoes the newest turn's file changes. Returns the restored paths, or undefined when there is nothing to rewind. */
  async rewind(): Promise<string[] | undefined> {
    if (this.rewinding) throw new Error('A rewind is already in progress.')
    const entry = this.stack.at(-1)
    if (!entry) return undefined
    this.rewinding = true
    try {
      for (const [path, bytes] of entry) {
        if (bytes === null) await rm(path, { force: true })
        else {
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, bytes)
        }
        this.reads.delete(path)
      }
      this.stack.pop() // only after every file was restored, so a failed rewind can be retried
      return [...entry.keys()]
    } finally {
      this.rewinding = false
    }
  }
}
