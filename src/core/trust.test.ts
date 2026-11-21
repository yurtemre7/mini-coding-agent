import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPrefs, recentWorkspaces, rememberWorkspace, savePrefs, trustWorkspace } from './trust'

const tmp = () => mkdtempSync(join(tmpdir(), 'mca-state-'))

describe('state.json', () => {
  it('keeps other keys, orders recents newest first, caps at 10 and drops folders that vanished', async () => {
    const home = tmp()
    mkdirSync(join(home, '.mca'))
    writeFileSync(join(home, '.mca', 'state.json'), JSON.stringify({ other: { keep: 1 } }))
    await trustWorkspace(home, home)
    const dirs = Array.from({ length: 12 }, (_, i) => join(home, `w${i}`))
    for (const d of dirs) (mkdirSync(d), await rememberWorkspace(d, home))
    await rememberWorkspace(dirs[5], home)
    await savePrefs({ model: 'm' }, home)
    await savePrefs({ effort: 'high' }, home)
    const r = await recentWorkspaces(home)
    expect(r).toHaveLength(10)
    expect(r[0]).toBe(dirs[5])
    expect(r.filter((d) => d === dirs[5])).toHaveLength(1)
    expect(await loadPrefs(home)).toEqual({ model: 'm', effort: 'high' })
    const raw = JSON.parse(readFileSync(join(home, '.mca', 'state.json'), 'utf8'))
    expect(raw.other).toEqual({ keep: 1 })
    expect(raw.trusted).toHaveLength(1)
    const { rmSync } = await import('node:fs')
    rmSync(dirs[5], { recursive: true })
    expect(await recentWorkspaces(home)).not.toContain(dirs[5])
  })
  it('refuses to overwrite a corrupt state file', async () => {
    const home = tmp()
    mkdirSync(join(home, '.mca'))
    writeFileSync(join(home, '.mca', 'state.json'), '{oops')
    await expect(rememberWorkspace(home, home)).rejects.toThrow(/corrupt/)
    expect(await recentWorkspaces(home)).toEqual([])
  })
})
