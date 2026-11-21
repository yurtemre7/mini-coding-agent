import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'
import { discoverSkills, loadSkill, skillsIndex } from './skill'
import { buildReminder } from './context'
import { Skill as skillTool } from './tools/skill'

const put = (base: string, rel: string, text: string) => {
  mkdirSync(join(base, dirname(rel)), { recursive: true })
  writeFileSync(join(base, rel), text)
}
const dirs = () => ({ home: mkdtempSync(join(tmpdir(), 'mca-sh-')), cwd: mkdtempSync(join(tmpdir(), 'mca-sp-')) })

describe('parseFrontmatter', () => {
  it('reads key: value pairs and the body', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: b c\n---\nbody')).toEqual({ meta: { name: 'a', description: 'b c' }, body: 'body' })
  })
  it('malformed or missing frontmatter is plain body text', () => {
    for (const t of ['no front', '---\nnot a pair\n---\nx', '---\nname: a\nbody']) expect(parseFrontmatter(t)).toEqual({ meta: {}, body: t })
  })
})

describe('skills', () => {
  it('discovers, lets project win, caps descriptions at 200 chars, falls back to folder name', async () => {
    const { home, cwd } = dirs()
    put(home, '.mca/skills/a/SKILL.md', '---\ndescription: home a\n---\nhome body')
    put(cwd, '.mca/skills/a/SKILL.md', '---\ndescription: project a\n---\nproject body')
    put(cwd, '.mca/skills/long/SKILL.md', `---\ndescription: ${'x'.repeat(500)}\n---\nb`)
    put(cwd, '.mca/skills/bad name!/SKILL.md', 'nope')
    const skills = await discoverSkills(cwd, { home })
    expect(skills.map((s) => s.name)).toEqual(['a', 'long'])
    expect(skills[0].description).toBe('project a')
    expect(skills[1].description.length).toBeLessThanOrEqual(200)
    expect(skillsIndex(skills)).toContain('- a: project a')
    expect(await loadSkill(skills[0])).toContain('project body')
  })
  it('the reminder lists skills (name + description only) and the Skill tool rejects unknown names', async () => {
    const { home, cwd } = dirs()
    put(cwd, '.mca/skills/deploy/SKILL.md', '---\ndescription: ship it\n---\nSECRET BODY')
    const r = await buildReminder(cwd, { home })
    expect(r).toContain('deploy: ship it')
    expect(r).not.toContain('SECRET BODY')
    await expect(skillTool.run({ name: 'nope' }, { root: cwd } as never)).rejects.toThrow(/deploy/)
    expect(await skillTool.run({ name: 'deploy' }, { root: cwd } as never)).toContain('SECRET BODY')
  })
})
