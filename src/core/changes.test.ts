import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diffFor, MAX_DIFF_BYTES, MAX_DIFF_CHARS, summarizeChanges } from './changes'

const root = () => mkdtempSync(join(tmpdir(), 'mca-ch-'))
const img = (o: Record<string, string | Buffer | null>) => new Map(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? Buffer.from(v) : v]))

describe('summarizeChanges', () => {
  it('added, modified and deleted statuses with +/- counts, sorted by relative path', async () => {
    const r = root()
    writeFileSync(join(r, 'm.txt'), 'a\nB\nc\n')
    writeFileSync(join(r, 'z.txt'), 'new\nfile\n')
    const out = await summarizeChanges(img({ [join(r, 'z.txt')]: null, [join(r, 'm.txt')]: 'a\nb\nc\n', [join(r, 'gone.txt')]: 'x\ny\n' }), r)
    expect(out).toEqual([
      { path: 'gone.txt', status: 'deleted', additions: 0, deletions: 2, binary: false, tooLarge: false },
      { path: 'm.txt', status: 'modified', additions: 1, deletions: 1, binary: false, tooLarge: false },
      { path: 'z.txt', status: 'added', additions: 2, deletions: 0, binary: false, tooLarge: false }
    ])
  })
  it('omits unchanged files and files created then deleted', async () => {
    const r = root()
    writeFileSync(join(r, 'same.txt'), 'x')
    expect(await summarizeChanges(img({ [join(r, 'same.txt')]: 'x', [join(r, 'never.txt')]: null }), r)).toEqual([])
  })
  it('a NUL-containing file is binary with no counts', async () => {
    const r = root()
    writeFileSync(join(r, 'b.bin'), Buffer.from([1, 0, 2]))
    const [c] = await summarizeChanges(img({ [join(r, 'b.bin')]: Buffer.from([1, 0, 3]) }), r)
    expect(c).toMatchObject({ binary: true, additions: 0, deletions: 0 })
    expect(await diffFor(img({ [join(r, 'b.bin')]: Buffer.from([1, 0, 3]) }), r, join(r, 'b.bin'))).toMatch(/Binary file/)
  })
  it('a file over 2 MB is tooLarge and diffFor returns a note', async () => {
    const r = root()
    writeFileSync(join(r, 'big.txt'), 'x'.repeat(MAX_DIFF_BYTES + 1))
    const images = img({ [join(r, 'big.txt')]: 'y' })
    expect((await summarizeChanges(images, r))[0]).toMatchObject({ tooLarge: true, additions: 0 })
    expect(await diffFor(images, r, join(r, 'big.txt'))).toMatch(/too large/i)
  })
  it('CRLF files diff per line, not as one changed blob', async () => {
    const r = root()
    writeFileSync(join(r, 'w.txt'), 'a\r\nB\r\nc\r\n')
    const [c] = await summarizeChanges(img({ [join(r, 'w.txt')]: 'a\r\nb\r\nc\r\n' }), r)
    expect(c).toMatchObject({ additions: 1, deletions: 1 })
  })
  it('skips paths outside the root', async () => {
    const r = root()
    const other = root()
    writeFileSync(join(other, 'o.txt'), 'x')
    expect(await summarizeChanges(img({ [join(other, 'o.txt')]: 'y' }), r)).toEqual([])
  })
})

describe('diffFor', () => {
  it('returns a unified diff with a/ and b/ headers, and undefined for an unknown path', async () => {
    const r = root()
    writeFileSync(join(r, 'm.txt'), 'a\nB\n')
    const images = img({ [join(r, 'm.txt')]: 'a\nb\n' })
    const d = (await diffFor(images, r, join(r, 'm.txt')))!
    expect(d).toContain('--- a/m.txt')
    expect(d).toContain('+++ b/m.txt')
    expect(d).toContain('-b')
    expect(d).toContain('+B')
    expect(await diffFor(images, r, join(r, 'nope.txt'))).toBeUndefined()
  })
  it('truncates a diff over 200,000 chars with a visible marker', async () => {
    const r = root()
    writeFileSync(join(r, 'l.txt'), Array.from({ length: 30000 }, (_, i) => `new line ${i}`).join('\n'))
    const d = (await diffFor(img({ [join(r, 'l.txt')]: 'old' }), r, join(r, 'l.txt')))!
    expect(d.length).toBeLessThanOrEqual(MAX_DIFF_CHARS + 50)
    expect(d.endsWith('[diff truncated]')).toBe(true)
  })
  it('a deleted file shows its lines as removals', async () => {
    const r = root()
    rmSync(join(r, 'x'), { force: true })
    const d = (await diffFor(img({ [join(r, 'x.txt')]: 'one\ntwo\n' }), r, join(r, 'x.txt')))!
    expect(d).toContain('-one')
  })
})
