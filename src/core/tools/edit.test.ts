import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FileState } from '../filestate'
import { Edit, Read, Write } from './files'
import { testCtx } from './testutil'

let dir: string
let ctx: ReturnType<typeof testCtx>
const f = (n: string) => join(dir, n)
const edit = (input: object) => Edit.run(input as any, ctx)
const write = (input: object) => Write.run(input as any, ctx)
const read = (file_path: string) => Read.run({ file_path } as any, ctx)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mca-edit-'))
  ctx = testCtx(dir, new FileState())
})

describe('Edit', () => {
  it('refuses an unread file, then works after Read, and consecutive edits need no re-read', async () => {
    writeFileSync(f('a.txt'), 'one two three')
    await expect(edit({ file_path: 'a.txt', old_string: 'one', new_string: '1' })).rejects.toThrow(/not been read/)
    await read('a.txt')
    await edit({ file_path: 'a.txt', old_string: 'one', new_string: '1' })
    await edit({ file_path: 'a.txt', old_string: 'two', new_string: '2' })
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('1 2 three')
  })
  it('a partial read counts as a read', async () => {
    writeFileSync(f('a.txt'), 'a\nb\nc\n')
    await Read.run({ file_path: 'a.txt', limit: 1 }, ctx)
    await edit({ file_path: 'a.txt', old_string: 'c', new_string: 'C' })
  })
  it('stale: changed content errors; changed mtime with identical content stays fresh', async () => {
    writeFileSync(f('a.txt'), 'hello')
    await read('a.txt')
    utimesSync(f('a.txt'), new Date(), new Date(Date.now() + 5000))
    await edit({ file_path: 'a.txt', old_string: 'hello', new_string: 'hi' }) // touched only
    await read('a.txt')
    writeFileSync(f('a.txt'), 'changed')
    utimesSync(f('a.txt'), new Date(), new Date(Date.now() + 9000))
    await expect(edit({ file_path: 'a.txt', old_string: 'changed', new_string: 'x' })).rejects.toThrow(/modified since/)
  })
  it('identical strings, empty old_string, no match, ambiguous', async () => {
    writeFileSync(f('a.txt'), 'x x')
    await read('a.txt')
    await expect(edit({ file_path: 'a.txt', old_string: 'x', new_string: 'x' })).rejects.toThrow(/identical/)
    await expect(edit({ file_path: 'a.txt', old_string: '', new_string: 'y' })).rejects.toThrow(/Write/)
    await expect(edit({ file_path: 'a.txt', old_string: 'zzz', new_string: 'y' })).rejects.toThrow(/whitespace/)
    await expect(edit({ file_path: 'a.txt', old_string: 'x', new_string: 'y' })).rejects.toThrow(/2 places/)
    await edit({ file_path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true })
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('y y')
  })
  it('treats $& and $1 in the replacement literally', async () => {
    writeFileSync(f('a.txt'), 'price')
    await read('a.txt')
    await edit({ file_path: 'a.txt', old_string: 'price', new_string: '$& $1 $$' })
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('$& $1 $$')
  })
  it('preserves CRLF line endings when old_string uses LF', async () => {
    writeFileSync(f('a.txt'), 'a\r\nb\r\nc\r\n')
    await read('a.txt')
    await edit({ file_path: 'a.txt', old_string: 'a\nb', new_string: 'A\nB' })
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('A\r\nB\r\nc\r\n')
  })
})

describe('Write', () => {
  it('creates a new file (and parents) without a prior read; overwriting needs one', async () => {
    await write({ file_path: 'deep/er/n.txt', content: 'v1' })
    expect(readFileSync(f('deep/er/n.txt'), 'utf8')).toBe('v1')
    await write({ file_path: 'deep/er/n.txt', content: 'v2' }) // Write recorded readState
    writeFileSync(f('o.txt'), 'old')
    await expect(write({ file_path: 'o.txt', content: 'new' })).rejects.toThrow(/not been read/)
    await read('o.txt')
    await write({ file_path: 'o.txt', content: 'new' })
    expect(readFileSync(f('o.txt'), 'utf8')).toBe('new')
  })
})

describe('checkpoints', () => {
  it('overlapping rewinds: the second errors instead of popping twice', async () => {
    writeFileSync(f('a.txt'), 'orig')
    ctx.files.beginTurn()
    ctx.files.beginTurn()
    await ctx.files.record(f('a.txt'))
    const [a, b] = await Promise.allSettled([ctx.files.rewind(), ctx.files.rewind()])
    expect([a.status, b.status]).toEqual(['fulfilled', 'rejected'])
    expect(await ctx.files.rewind()).toEqual([]) // exactly one entry was popped by the pair
  })
  it('rewind restores originals and removes created files; first touch per turn wins; one entry per turn', async () => {
    writeFileSync(f('a.txt'), 'orig')
    await read('a.txt')
    ctx.files.beginTurn()
    await edit({ file_path: 'a.txt', old_string: 'orig', new_string: 'mid' })
    await edit({ file_path: 'a.txt', old_string: 'mid', new_string: 'last' })
    await write({ file_path: 'new.txt', content: 'n' })
    ctx.files.beginTurn()
    await edit({ file_path: 'a.txt', old_string: 'last', new_string: 'turn2' })
    expect(await ctx.files.rewind()).toEqual([f('a.txt')])
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('last')
    await ctx.files.rewind()
    expect(readFileSync(f('a.txt'), 'utf8')).toBe('orig')
    expect(existsSync(f('new.txt'))).toBe(false)
    expect(await ctx.files.rewind()).toBeUndefined()
    rmSync(dir, { recursive: true })
  })
})
