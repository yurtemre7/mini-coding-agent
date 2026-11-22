import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it } from 'vitest'
import { gitBranches, gitCommit, gitDiff, gitPush, gitStage, gitStatus, gitSwitch } from './git'

let dir: string
const sh = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mca-git-'))
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 't@t')
  sh('config', 'user.name', 't')
  sh('config', 'commit.gpgsign', 'false')
})

describe('git', () => {
  it('reports a non-repo without throwing', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mca-nogit-'))
    expect((await gitStatus(plain)).repo).toBe(false)
  })

  it('stages, diffs, commits and lists branches', async () => {
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'a.txt'), 'one\n')
    let s = await gitStatus(dir)
    expect(s).toMatchObject({ repo: true, branch: 'main', files: [{ path: 'src/a.txt', index: '', worktree: '?' }] })
    expect(await gitDiff(dir, 'src/a.txt', false)).toContain('+one')
    await expect(gitCommit(dir, 'x')).rejects.toThrow(/Nothing is staged/)
    await gitStage(dir, ['src/a.txt'], true)
    expect((await gitStatus(dir)).files[0]).toMatchObject({ index: 'A', worktree: '' })
    expect(await gitDiff(dir, 'src/a.txt', true)).toContain('+one')
    await gitStage(dir, ['src/a.txt'], false) // works before the first commit too
    expect((await gitStatus(dir)).files[0].index).toBe('')
    await gitStage(dir, ['src/a.txt'], true)
    await expect(gitCommit(dir, '  ')).rejects.toThrow(/commit message/)
    expect(await gitCommit(dir, 'first')).toMatch(/^[0-9a-f]{4,}$/)
    await writeFile(join(dir, 'src', 'a.txt'), 'two\n')
    s = await gitStatus(dir)
    expect(s.files[0]).toMatchObject({ index: '', worktree: 'M' })
    expect(await gitDiff(dir, 'src/a.txt', false)).toMatch(/-one\n\+two/)
    expect(await gitBranches(dir)).toEqual({ current: 'main', branches: ['main'] })
  })

  it('creates and switches branches, rejecting bad names', async () => {
    await writeFile(join(dir, 'a'), '1')
    await gitStage(dir, ['a'], true)
    await gitCommit(dir, 'c1')
    await gitSwitch(dir, 'feature/x', true)
    expect(await gitBranches(dir)).toEqual({ current: 'feature/x', branches: ['feature/x', 'main'] })
    await gitSwitch(dir, 'main', false)
    expect((await gitStatus(dir)).branch).toBe('main')
    await expect(gitSwitch(dir, 'bad name', true)).rejects.toThrow(/not a valid branch name/)
    await expect(gitSwitch(dir, '--detach', false)).rejects.toThrow(/Invalid branch name/)
  })

  it('refuses paths that escape or look like options, and push without a remote fails with git\'s message', async () => {
    await expect(gitStage(dir, ['../x'], true)).rejects.toThrow(/Invalid path/)
    await expect(gitDiff(dir, '--output=/tmp/x', false)).rejects.toThrow(/Invalid path/)
    await expect(gitStage(dir, ['/etc/passwd'], true)).rejects.toThrow(/Invalid path/)
    await writeFile(join(dir, 'a'), '1')
    await gitStage(dir, ['a'], true)
    await gitCommit(dir, 'c1')
    await expect(gitPush(dir)).rejects.toThrow()
  })

  it('pushes to a bare remote, setting the upstream once', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'mca-remote-'))
    execFileSync('git', ['init', '-q', '--bare', remote])
    sh('remote', 'add', 'origin', remote)
    await writeFile(join(dir, 'a'), '1')
    await gitStage(dir, ['a'], true)
    await gitCommit(dir, 'c1')
    await gitPush(dir)
    expect((await gitStatus(dir)).upstream).toBe('origin/main')
    await writeFile(join(dir, 'a'), '2')
    await gitStage(dir, ['a'], true)
    await gitCommit(dir, 'c2')
    expect((await gitStatus(dir)).ahead).toBe(1)
    await gitPush(dir)
    expect((await gitStatus(dir)).ahead).toBe(0)
  })
})
