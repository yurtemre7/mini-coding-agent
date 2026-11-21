import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CheckpointStore } from './checkpoints'
import { FileState } from './filestate'

const mk = () => {
  const root = mkdtempSync(join(tmpdir(), 'mca-fs-'))
  return { root, ck: join(root, 'ck'), file: (n: string, c?: string) => (c !== undefined && writeFileSync(join(root, n), c), join(root, n)) }
}

describe('FileState persistence', () => {
  it('a new FileState attached to the same dir sees the previous turns and rewinds them', async () => {
    const { ck, file } = mk()
    const a = file('a.txt', 'orig')
    const first = new FileState()
    await first.attach(new CheckpointStore(ck))
    first.beginTurn()
    await first.record(a)
    writeFileSync(a, 'edited')
    const second = new FileState() // "restart"
    expect(await second.attach(new CheckpointStore(ck))).toEqual([])
    expect(await second.rewind()).toEqual([a])
    expect(readFileSync(a, 'utf8')).toBe('orig')
    expect(await new FileState().attach(new CheckpointStore(ck))).toEqual([])
    const third = new FileState()
    await third.attach(new CheckpointStore(ck))
    expect(await third.rewind()).toBeUndefined() // the rewound turn was removed from disk
  })
  it('new turns after a resume get fresh ids', async () => {
    const { ck, file } = mk()
    const a = file('a.txt', 'x')
    const one = new FileState()
    await one.attach(new CheckpointStore(ck))
    one.beginTurn()
    await one.record(a)
    const two = new FileState()
    await two.attach(new CheckpointStore(ck))
    two.beginTurn()
    await two.record(a)
    const { turns } = await new CheckpointStore(ck).load()
    expect(new Set(turns.map((t) => t.id)).size).toBe(2)
  })
  it('a fork shares the store and the stack', async () => {
    const { ck, file } = mk()
    const a = file('a.txt', 'x')
    const parent = new FileState()
    await parent.attach(new CheckpointStore(ck))
    parent.beginTurn()
    await parent.fork().record(a)
    expect((await new CheckpointStore(ck).load()).turns).toHaveLength(1)
  })
})

describe('beforeImages and revertFile', () => {
  const setup = async () => {
    const { file } = mk()
    const a = file('a.txt', 'a0')
    const b = file('b.txt', 'b0')
    const fs = new FileState()
    fs.beginTurn()
    await fs.record(a)
    writeFileSync(a, 'a1')
    fs.beginTurn()
    await fs.record(a)
    await fs.record(b)
    writeFileSync(a, 'a2')
    writeFileSync(b, 'b1')
    return { fs, a, b }
  }
  it("'all' returns the oldest before-image per path; 'turn' the newest turn's", async () => {
    const { fs, a, b } = await setup()
    expect(fs.beforeImages('all').get(a)?.toString()).toBe('a0')
    expect(fs.beforeImages('turn').get(a)?.toString()).toBe('a1')
    expect([...fs.beforeImages('turn').keys()].sort()).toEqual([a, b].sort())
  })
  it("revertFile('turn') restores only that path and leaves the others", async () => {
    const { fs, a, b } = await setup()
    expect(await fs.revertFile(b, 'turn')).toBe(true)
    expect(readFileSync(b, 'utf8')).toBe('b0')
    expect(readFileSync(a, 'utf8')).toBe('a2')
    expect(fs.beforeImages('turn').has(b)).toBe(false)
  })
  it("revertFile('all') goes back to the oldest before-image and clears it from every turn", async () => {
    const { fs, a } = await setup()
    expect(await fs.revertFile(a, 'all')).toBe(true)
    expect(readFileSync(a, 'utf8')).toBe('a0')
    expect(fs.beforeImages('all').has(a)).toBe(false)
  })
  it('refuses a path that was not changed and touches nothing', async () => {
    const { fs } = await setup()
    const other = join(mkdtempSync(join(tmpdir(), 'mca-other-')), 'x.txt')
    writeFileSync(other, 'keep')
    expect(await fs.revertFile(other, 'turn')).toBe(false)
    expect(readFileSync(other, 'utf8')).toBe('keep')
  })
  it('a file created in the turn reverts to absent', async () => {
    const { root } = mk()
    const n = join(root, 'new.txt')
    const fs = new FileState()
    fs.beginTurn()
    await fs.record(n)
    writeFileSync(n, 'created')
    expect(await fs.revertFile(n, 'turn')).toBe(true)
    expect(existsSync(n)).toBe(false)
  })
})
