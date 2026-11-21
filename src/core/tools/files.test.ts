import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { testCtx } from './testutil'
import { Read } from './files'

let dir: string
const read = (input: object) => Read.run(input as any, testCtx(dir))

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mca-read-'))
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(dir, 'empty.txt'), '')
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
  writeFileSync(join(dir, 'big.txt'), 'x'.repeat(300 * 1024))
  writeFileSync(join(dir, 'long.txt'), 'y'.repeat(5000) + '\n')
  writeFileSync(join(dir, 'many.txt'), Array.from({ length: 2500 }, (_, i) => `l${i + 1}`).join('\n'))
  mkdirSync(join(dir, 'sub'))
})

describe('Read', () => {
  it('numbers lines cat -n style', async () => expect(await read({ file_path: 'a.txt' })).toBe('     1\tone\n     2\ttwo\n     3\tthree'))
  it('errors on a directory, suggesting Glob', async () => await expect(read({ file_path: 'sub' })).rejects.toThrow(/Glob/))
  it('errors on a missing file with the resolved path', async () => await expect(read({ file_path: 'nope.txt' })).rejects.toThrow(`File not found: ${join(dir, 'nope.txt')}`))
  it('refuses binary files (NUL in first 8 KB)', async () => await expect(read({ file_path: 'bin.dat' })).rejects.toThrow(/binary/))
  it('reports an empty file', async () => expect(await read({ file_path: 'empty.txt' })).toBe('(file is empty)'))
  it('refuses >256 KB without offset/limit, allows it with a window', async () => {
    await expect(read({ file_path: 'big.txt' })).rejects.toThrow(/Grep/)
    expect(await read({ file_path: 'big.txt', limit: 1 })).toContain('1\t')
  })
  it('truncates lines over 2000 characters', async () => expect((await read({ file_path: 'long.txt' })).length).toBeLessThan(2100))
  it('limits to 2000 lines by default and says how to continue; offset/limit window works', async () => {
    const out = await read({ file_path: 'many.txt' })
    expect(out).toContain('  2000\tl2000')
    expect(out).not.toContain('l2001')
    expect(out).toContain('offset=2001')
    expect(await read({ file_path: 'many.txt', offset: 2499, limit: 5 })).toBe('  2499\tl2499\n  2500\tl2500')
  })
  it('handles an offset past the end', async () => expect(await read({ file_path: 'a.txt', offset: 10 })).toContain('past the end'))
})
