import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One turn's before-images: absolute path -> original bytes (null = the file did not exist). */
export interface TurnRecord {
  id: number
  files: Map<string, Buffer | null>
}

export const DEFAULT_MAX_CHECKPOINT_BYTES = 200 * 1024 * 1024

interface Manifest {
  id: number
  files: Record<string, string | null> // path -> blob sha1
}

const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex')
const manifestName = (id: number): string => `turn-${id}.json`
const isManifest = (v: unknown): v is Manifest => {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Manifest
  return Number.isInteger(m.id) && typeof m.files === 'object' && m.files !== null && Object.values(m.files).every((h) => h === null || /^[0-9a-f]{40}$/.test(h))
}

/**
 * Rewind checkpoints on disk: `<dir>/blobs/<sha1>` (content-addressed, shared by turns) and `<dir>/turn-<id>.json`.
 * Bounded: after a save the oldest turns are dropped until the referenced blobs fit in `maxBytes`.
 */
export class CheckpointStore {
  private readonly maxBytes: number
  constructor(
    private readonly dir: string,
    o: { maxBytes?: number } = {}
  ) {
    this.maxBytes = o.maxBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES
  }

  private get blobs(): string {
    return join(this.dir, 'blobs')
  }

  private async manifests(): Promise<{ manifests: Manifest[]; warnings: string[] }> {
    const manifests: Manifest[] = []
    const warnings: string[] = []
    const names = await readdir(this.dir).catch(() => [] as string[])
    for (const name of names.filter((n) => /^turn-\d+\.json$/.test(n))) {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.dir, name), 'utf8'))
        if (!isManifest(parsed)) throw new Error('unexpected shape')
        manifests.push(parsed)
      } catch (e) {
        warnings.push(`Skipped damaged checkpoint ${name}: ${(e as Error).message}`)
      }
    }
    return { manifests: manifests.sort((a, b) => a.id - b.id), warnings }
  }

  async load(): Promise<{ turns: TurnRecord[]; warnings: string[] }> {
    const { manifests, warnings } = await this.manifests()
    const turns: TurnRecord[] = []
    for (const m of manifests) {
      try {
        const files = new Map<string, Buffer | null>()
        for (const [path, hash] of Object.entries(m.files)) files.set(path, hash === null ? null : await readFile(join(this.blobs, hash)))
        turns.push({ id: m.id, files })
      } catch (e) {
        warnings.push(`Skipped damaged checkpoint ${manifestName(m.id)}: ${(e as Error).message}`)
      }
    }
    return { turns, warnings }
  }

  /** Writes the turn (blobs first, then the manifest by rename) and returns the ids evicted to stay under the size cap. */
  async save(turn: TurnRecord): Promise<number[]> {
    await mkdir(this.blobs, { recursive: true })
    const files: Record<string, string | null> = {}
    for (const [path, bytes] of turn.files) {
      if (bytes === null) {
        files[path] = null
        continue
      }
      const hash = sha1(bytes)
      await writeFile(join(this.blobs, hash), bytes)
      files[path] = hash
    }
    const tmp = join(this.dir, `${manifestName(turn.id)}.tmp`)
    await writeFile(tmp, JSON.stringify({ id: turn.id, files } satisfies Manifest))
    await rename(tmp, join(this.dir, manifestName(turn.id)))

    const { manifests } = await this.manifests()
    const evicted: number[] = []
    const kept = [...manifests]
    while (kept.length > 1 && kept[0].id !== turn.id && (await this.size(kept)) > this.maxBytes) {
      const old = kept.shift()!
      evicted.push(old.id)
      await rm(join(this.dir, manifestName(old.id)), { force: true })
    }
    if (evicted.length) await this.collect(kept)
    return evicted
  }

  async remove(id: number): Promise<void> {
    await rm(join(this.dir, manifestName(id)), { force: true })
    await this.collect((await this.manifests()).manifests)
  }

  private referenced(manifests: Manifest[]): Set<string> {
    return new Set(manifests.flatMap((m) => Object.values(m.files).filter((h): h is string => h !== null)))
  }

  private async size(manifests: Manifest[]): Promise<number> {
    let total = 0
    for (const hash of this.referenced(manifests)) total += (await stat(join(this.blobs, hash)).catch(() => ({ size: 0 }))).size
    return total
  }

  /** Deletes blobs no remaining turn refers to. */
  private async collect(manifests: Manifest[]): Promise<void> {
    const keep = this.referenced(manifests)
    for (const name of await readdir(this.blobs).catch(() => [] as string[])) if (!keep.has(name)) await rm(join(this.blobs, name), { force: true })
  }
}
