import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInsideWorkspace, isProtectedPath, resolvePath } from './paths'

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mca-paths-')))
const outside = realpathSync(mkdtempSync(join(tmpdir(), 'mca-outside-')))
mkdirSync(join(dir, 'sub'))
symlinkSync(outside, join(dir, 'escape'))

describe('paths', () => {
  it('resolves absolute, relative and ~', () => {
    expect(resolvePath(dir, 'a/b')).toBe(join(dir, 'a/b'))
    expect(resolvePath(dir, '/x/y')).toBe('/x/y')
    expect(resolvePath(dir, '~/z')).toBe(join(homedir(), 'z'))
  })
  it('workspace check uses realpath of the nearest existing ancestor', () => {
    expect(isInsideWorkspace(dir, join(dir, 'sub/new/file.txt'))).toBe(true)
    expect(isInsideWorkspace(dir, join(dir, '..', 'x'))).toBe(false)
    expect(isInsideWorkspace(dir, join(dir, 'escape/new.txt'))).toBe(false) // symlink escape, file not yet existing
    expect(isInsideWorkspace(dir, join(dir, 'escape'))).toBe(false)
  })
  it('flags protected paths', () => {
    for (const p of ['.git/config', 'sub/.git/hooks/pre-commit', '.mca/settings.json', '.mca/settings.local.json', '.claude/settings.json', '.mcp.json', join(homedir(), '.mca/hooks/x')])
      expect(isProtectedPath(resolve(dir, p))).toBe(true)
    for (const p of ['src/a.ts', '.mca/notes.md', '.gitignore']) expect(isProtectedPath(join(dir, p))).toBe(false)
  })
  it('protected check sees through a symlink', () => {
    mkdirSync(join(dir, '.git'))
    symlinkSync(join(dir, '.git'), join(dir, 'gitlink'))
    expect(isProtectedPath(join(dir, 'gitlink/config'))).toBe(true)
  })
})
