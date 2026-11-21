import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CheckpointStore } from './checkpoints'

const dir = () => join(mkdtempSync(join(tmpdir(), 'mca-ck-')), 'ck')
const turn = (id: number, files: Record<string, string | null>) => ({ id, files: new Map(Object.entries(files).map(([k, v]) => [k, v === null ? null : Buffer.from(v)])) })

describe('CheckpointStore', () => {
  it('round-trips a turn including a null (new file) entry', async () => {
    const s = new CheckpointStore(dir())
    await s.save(turn(1, { '/a': 'one', '/b': null }))
    const { turns, warnings } = await s.load()
    expect(warnings).toEqual([])
    expect(turns).toHaveLength(1)
    expect(turns[0].id).toBe(1)
    expect(turns[0].files.get('/a')?.toString()).toBe('one')
    expect(turns[0].files.get('/b')).toBeNull()
  })
  it('identical content across turns is stored once', async () => {
    const d = dir()
    const s = new CheckpointStore(d)
    await s.save(turn(1, { '/a': 'same' }))
    await s.save(turn(2, { '/b': 'same' }))
    expect(readdirSync(join(d, 'blobs'))).toHaveLength(1)
  })
  it('evicts the oldest turns when over maxBytes and keeps the newest', async () => {
    const s = new CheckpointStore(dir(), { maxBytes: 10 })
    expect(await s.save(turn(1, { '/a': 'aaaaaa' }))).toEqual([])
    expect(await s.save(turn(2, { '/b': 'bbbbbb' }))).toEqual([1])
    expect(await s.save(turn(3, { '/c': 'cccccc' }))).toEqual([2])
    const { turns } = await s.load()
    expect(turns.map((t) => t.id)).toEqual([3])
  })
  it('a truncated manifest is skipped with one warning and the others load', async () => {
    const d = dir()
    const s = new CheckpointStore(d)
    await s.save(turn(1, { '/a': 'x' }))
    await s.save(turn(2, { '/b': 'y' }))
    writeFileSync(join(d, 'turn-1.json'), '{"id":1,"fil')
    const { turns, warnings } = await s.load()
    expect(turns.map((t) => t.id)).toEqual([2])
    expect(warnings).toHaveLength(1)
  })
  it('remove deletes the manifest and garbage-collects unreferenced blobs', async () => {
    const d = dir()
    const s = new CheckpointStore(d)
    await s.save(turn(1, { '/a': 'one' }))
    await s.save(turn(2, { '/b': 'two' }))
    await s.remove(1)
    expect(existsSync(join(d, 'turn-1.json'))).toBe(false)
    expect(readdirSync(join(d, 'blobs'))).toHaveLength(1)
  })
  it('loads an empty store', async () => {
    expect(await new CheckpointStore(dir()).load()).toEqual({ turns: [], warnings: [] })
  })
})
