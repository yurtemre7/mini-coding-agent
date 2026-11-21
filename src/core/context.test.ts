import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildReminder, discoverInstructions, expandImports, MAX_FILE_CHARS } from './context'

const dir = () => mkdtempSync(join(tmpdir(), 'mca-ctx-'))
const write = (p: string, s: string) => (mkdirSync(join(p, '..'), { recursive: true }), writeFileSync(p, s))

describe('discoverInstructions', () => {
  it('orders user files, then root down to cwd, and de-duplicates symlinks and identical copies', async () => {
    const home = dir()
    const root = dir()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(join(home, '.mca', 'AGENTS.md'), 'user')
    write(join(root, 'AGENTS.md'), 'root')
    symlinkSync(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md')) // symlink to the same file
    write(join(root, 'pkg', 'AGENTS.md'), 'pkg')
    write(join(root, 'pkg', 'CLAUDE.md'), 'pkg') // same content as AGENTS.md
    write(join(root, 'pkg', 'CLAUDE.local.md'), 'local')
    const files = await discoverInstructions(join(root, 'pkg'), { home })
    expect(files.map((f) => f.content)).toEqual(['user', 'root', 'pkg', 'local'])
  })
  it('works outside a git repo (cwd only)', async () => {
    const d = dir()
    write(join(d, 'AGENTS.md'), 'solo')
    expect((await discoverInstructions(d, { home: dir() })).map((f) => f.content)).toEqual(['solo'])
  })
})

describe('expandImports', () => {
  const home = '/nonexistent'
  it('inlines @files relative to the importing file', async () => {
    const d = dir()
    write(join(d, 'a.md'), 'see @sub/b.md now')
    write(join(d, 'sub', 'b.md'), 'B @c.md')
    write(join(d, 'sub', 'c.md'), 'C')
    expect(await expandImports('see @sub/b.md now', join(d, 'a.md'), home)).toBe('see B C now')
  })
  it('leaves cycles, missing files and binaries as literal text', async () => {
    const d = dir()
    write(join(d, 'a.md'), 'A @b.md')
    write(join(d, 'b.md'), 'B @a.md')
    write(join(d, 'bin'), 'x\0y')
    expect(await expandImports('A @b.md', join(d, 'a.md'), home)).toBe('A B @a.md')
    expect(await expandImports('@missing.md and @bin', join(d, 'a.md'), home)).toBe('@missing.md and @bin')
  })
  it('does not import inside code spans or fences', async () => {
    const d = dir()
    write(join(d, 'b.md'), 'B')
    const text = 'use `@b.md` here\n```\n@b.md\n```\n@b.md'
    expect(await expandImports(text, join(d, 'a.md'), home)).toBe('use `@b.md` here\n```\n@b.md\n```\nB')
  })
  it('stops at depth 5', async () => {
    const d = dir()
    for (let i = 0; i < 8; i++) write(join(d, `f${i}.md`), `L${i} @f${i + 1}.md`)
    const out = await expandImports('@f0.md', join(d, 'root.md'), home)
    expect(out).toContain('L4')
    expect(out).not.toContain('L6')
  })
})

describe('buildReminder', () => {
  it('has the date, the git snapshot and a truncation marker for huge files', async () => {
    const root = dir()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(join(root, 'AGENTS.md'), 'x'.repeat(MAX_FILE_CHARS + 500))
    const r = await buildReminder(root, { home: dir(), now: new Date('2026-01-02T00:00:00Z') })
    expect(r.startsWith('<system-reminder>')).toBe(true)
    expect(r).toContain("Today's date is 2026-01-02.")
    expect(r).toContain('Git branch:')
    expect(r).toContain('[truncated: 500 more characters]')
  })
  it('skips git outside a repo', async () => {
    expect(await buildReminder(dir(), { home: dir() })).not.toContain('Git branch')
  })
})

describe('discoverInstructions with a symlinked cwd', () => {
  it('still walks from the git root down (macOS temp dirs are symlinks)', async () => {
    const root = dir()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(join(root, 'AGENTS.md'), 'root')
    write(join(root, 'pkg', 'AGENTS.md'), 'pkg')
    const link = join(dir(), 'link')
    symlinkSync(root, link)
    const files = await discoverInstructions(join(link, 'pkg'), { home: dir() })
    expect(files.map((f) => f.content)).toEqual(['root', 'pkg'])
  })
})
