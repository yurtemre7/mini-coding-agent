import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import './test-home'
import { listWorkspaceFiles } from './workspace-files'

const tmp = () => mkdtempSync(join(tmpdir(), 'mca-wf-'))

describe('listWorkspaceFiles', () => {
  it('in a git repo lists tracked and untracked files but not ignored ones', async () => {
    const d = tmp()
    execFileSync('git', ['init', '-q'], { cwd: d })
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src/a.ts'), '')
    writeFileSync(join(d, 'b.md'), '')
    writeFileSync(join(d, '.gitignore'), 'secret.txt\n')
    writeFileSync(join(d, 'secret.txt'), '')
    execFileSync('git', ['add', 'src/a.ts'], { cwd: d })
    expect((await listWorkspaceFiles(d)).sort()).toEqual(['.gitignore', 'b.md', 'src/a.ts'])
  })
  it('without git walks the tree, skipping dependency folders, hidden folders and symlinks', async () => {
    const d = tmp()
    for (const p of ['src', 'node_modules/x', '.hidden']) mkdirSync(join(d, p), { recursive: true })
    for (const p of ['src/a.ts', 'node_modules/x/i.js', '.hidden/h', 'top.txt']) writeFileSync(join(d, p), '')
    symlinkSync('/etc', join(d, 'link'))
    expect((await listWorkspaceFiles(d)).sort()).toEqual(['src/a.ts', 'top.txt'])
  })
  it('a missing directory gives an empty list', async () => {
    expect(await listWorkspaceFiles(join(tmp(), 'nope'))).toEqual([])
  })
})
