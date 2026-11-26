import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disabledSkills, lastWorkspace, newestIn, folderRoots, addFolderRoot, removeFolderRoot, loadPrefs, recentWorkspaces, rememberWorkspace, reorderWorkspaces, savePrefs, setSkillEnabled, trustWorkspace } from './trust'

const tmp = () => mkdtempSync(join(tmpdir(), 'mca-state-'))

describe('state.json', () => {
  it('keeps other keys, puts new folders on top without moving known ones, caps the list and drops folders that vanished', async () => {
    const home = tmp()
    mkdirSync(join(home, '.mca'))
    writeFileSync(join(home, '.mca', 'state.json'), JSON.stringify({ other: { keep: 1 } }))
    await trustWorkspace(home, home)
    const dirs = Array.from({ length: 32 }, (_, i) => join(home, `w${i}`))
    for (const d of dirs) {
      mkdirSync(d)
      await rememberWorkspace(d, home)
    }
    await rememberWorkspace(dirs[5], home)
    await savePrefs({ model: 'm' }, home)
    await savePrefs({ effort: 'high' }, home)
    const r = await recentWorkspaces(home)
    expect(r).toHaveLength(30)
    expect(r[0]).toBe(dirs[31]) // reopening w5 did not move it
    expect(r.filter((d) => d === dirs[5])).toHaveLength(1)
    expect(await loadPrefs(home)).toEqual({ model: 'm', effort: 'high' })
    const raw = JSON.parse(readFileSync(join(home, '.mca', 'state.json'), 'utf8'))
    expect(raw.other).toEqual({ keep: 1 })
    expect(raw.trusted).toHaveLength(1)
    const { rmSync } = await import('node:fs')
    rmSync(dirs[5], { recursive: true })
    expect(await recentWorkspaces(home)).not.toContain(dirs[5])
  })
  it('reorders the list without losing entries, and launch reopens the last opened one, not the top', async () => {
    const home = tmp()
    const [a, b, c] = ['a', 'b', 'c'].map((n) => join(home, n))
    for (const d of [a, b, c]) {
      mkdirSync(d)
      await rememberWorkspace(d, home)
    }
    expect(await recentWorkspaces(home)).toEqual([c, b, a])
    await reorderWorkspaces([a, '/not/listed', c, a], home) // unknown paths and duplicates are ignored; b was left out and keeps its place at the end
    expect(await recentWorkspaces(home)).toEqual([a, c, b])
    await rememberWorkspace(b, home)
    expect(await recentWorkspaces(home)).toEqual([a, c, b])
    expect(await lastWorkspace(home)).toBe(b)
  })
  it('refuses to overwrite a corrupt state file', async () => {
    const home = tmp()
    mkdirSync(join(home, '.mca'))
    writeFileSync(join(home, '.mca', 'state.json'), '{oops')
    await expect(rememberWorkspace(home, home)).rejects.toThrow(/corrupt/)
    expect(await recentWorkspaces(home)).toEqual([])
  })
  it('lists only direct subfolders of the allowed folders, without excluded, hidden or nested ones', () => {
    const root = tmp()
    for (const n of ['a', 'b', '.hidden', '_archive', join('a', 'deep')]) mkdirSync(join(root, n))
    writeFileSync(join(root, 'file.txt'), 'x')
    const got = newestIn([root, join(root, 'missing')])
    expect([...got].sort()).toEqual([join(root, 'a'), join(root, 'b')]) // no a/deep, no hidden, no file
    expect(newestIn([root], [join(root, 'a')])).toEqual([join(root, 'b')])
    expect(newestIn([root], [], 1)).toHaveLength(1)
    expect(newestIn([])).toEqual([])
  })
  it('remembers allowed folders without duplicates and drops vanished ones', async () => {
    const home = tmp()
    const dir = tmp()
    await addFolderRoot(dir, home)
    await addFolderRoot(dir, home)
    await addFolderRoot(join(home, 'gone'), home)
    expect(await folderRoots(home)).toEqual([dir])
    await removeFolderRoot(dir, home)
    expect(await folderRoots(home)).toEqual([])
  })
  it('remembers switched-off skills without duplicates and keeps the other keys', async () => {
    const home = tmp()
    await savePrefs({ model: 'm' }, home)
    await setSkillEnabled('a', false, home)
    await setSkillEnabled('a', false, home)
    await setSkillEnabled('b', false, home)
    expect(await disabledSkills(home)).toEqual(['a', 'b'])
    await setSkillEnabled('a', true, home)
    expect(await disabledSkills(home)).toEqual(['b'])
    expect((await loadPrefs(home)).model).toBe('m')
  })
})
