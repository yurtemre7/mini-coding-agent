import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Glob, Grep } from './search'
import { testCtx } from './testutil'

let dir: string
const glob = (i: object) => Glob.run(i as any, testCtx(dir))
const grep = (i: object) => Grep.run(i as any, testCtx(dir))

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mca-search-'))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'ignored'))
  mkdirSync(join(dir, '.git'))
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n')
  writeFileSync(join(dir, '.git/x.ts'), 'needle')
  writeFileSync(join(dir, 'ignored/i.ts'), 'needle')
  writeFileSync(join(dir, 'src/a.ts'), 'const needle = 1\nother\n')
  writeFileSync(join(dir, 'src/b.md'), 'Needle docs\n')
  for (let i = 0; i < 105; i++) writeFileSync(join(dir, `f${i}.txt`), 'x')
  utimesSync(join(dir, 'src/a.ts'), new Date(), new Date(Date.now() + 60_000)) // newest
})

describe('Glob', () => {
  it('finds by pattern, relative paths, skips .git and gitignored', async () => {
    expect((await glob({ pattern: '*.ts' })).split('\n')).toEqual(['src/a.ts'])
  })
  it('caps at 100 results, newest first, and says how many were omitted', async () => {
    const out = await glob({ pattern: '*' })
    expect(out.split('\n')[0]).toBe('src/a.ts')
    expect(out).toMatch(/\(\d+ more files omitted/)
    expect(out.split('\n').filter((l) => l && !l.startsWith('(')).length).toBe(100)
  })
  it('no matches and missing path', async () => {
    expect(await glob({ pattern: '*.nope' })).toBe('No matches.')
    await expect(glob({ pattern: '*', path: 'missing' })).rejects.toThrow(/does not exist/)
  })
})

describe('Grep', () => {
  it('files_with_matches by default', async () => expect(await grep({ pattern: 'needle' })).toBe('src/a.ts\n'))
  it('content mode with line numbers, ignore_case, glob', async () => {
    expect(await grep({ pattern: 'needle', output_mode: 'content' })).toBe('src/a.ts:1:const needle = 1\n')
    expect((await grep({ pattern: 'needle', ignore_case: true, glob: '*.md' })).trim()).toBe('src/b.md')
  })
  it('single-file path', async () => expect(await grep({ pattern: 'other', path: 'src/a.ts', output_mode: 'content' })).toContain('other'))
  it('exit 1 = No matches., exit 2 (bad regex) returns stderr, missing path errors', async () => {
    expect(await grep({ pattern: 'zzzzz' })).toBe('No matches.')
    await expect(grep({ pattern: '(' })).rejects.toThrow(/regex/i)
    await expect(grep({ pattern: 'a', path: 'nope' })).rejects.toThrow(/does not exist/)
  })
  it('caps content at 20k characters', async () => {
    writeFileSync(join(dir, 'big.log'), Array.from({ length: 2000 }, (_, i) => `hit ${i} ${'y'.repeat(30)}`).join('\n'))
    expect((await grep({ pattern: 'hit', output_mode: 'content' })).length).toBeLessThan(20_300)
  })
})
