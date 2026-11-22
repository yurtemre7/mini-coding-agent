import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'
import { discoverSkills, enabledSkills, loadSkill, skillsIndex } from './skill'
import { loadCommands, parseInput } from './commands'
import { setSkillEnabled } from './trust'
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
  it('finds Claude Code, plugin and Antigravity skills and labels where each came from', async () => {
    const { home, cwd } = dirs()
    put(home, '.claude/skills/mine/SKILL.md', '---\ndescription: user skill\n---\nb')
    put(home, '.claude/plugins/cache/acme/tools/1.0.0/skills/ponytail/SKILL.md', '---\ndescription: from a plugin\n---\nb')
    put(home, '.claude/plugins/cache/acme/node_modules/x/skills/hidden/SKILL.md', 'skipped')
    put(home, '.gemini/antigravity/skills/agy/SKILL.md', '---\ndescription: antigravity\n---\nb')
    put(cwd, '.agent/skills/agyproject/SKILL.md', '---\ndescription: workspace antigravity\n---\nb')
    put(cwd, '.claude/skills/proj/SKILL.md', '---\ndescription: project\n---\nb')
    const by = Object.fromEntries((await discoverSkills(cwd, { home })).map((s) => [s.name, s.source]))
    expect(by).toEqual({ mine: 'claude', ponytail: 'plugin', agy: 'antigravity', agyproject: 'antigravity', proj: 'project' })
  })
  it('a skill switched off in Settings leaves the reminder, the Skill tool and /name; switching it on brings it back', async () => {
    const { home, cwd } = dirs()
    put(home, '.mca/skills/ponytail/SKILL.md', '---\ndescription: ride\n---\nPONY BODY')
    expect((await loadCommands(cwd, { home })).map((c) => c.name)).toContain('ponytail')
    await setSkillEnabled('ponytail', false, home)
    expect((await enabledSkills(cwd, { home })).map((s) => s.name)).toEqual([])
    expect((await discoverSkills(cwd, { home })).map((s) => s.name)).toEqual(['ponytail']) // still listed for Settings
    expect(await buildReminder(cwd, { home })).not.toContain('ponytail')
    expect(parseInput('/ponytail go', await loadCommands(cwd, { home }))).toEqual({ kind: 'unknown', name: 'ponytail' })
    await setSkillEnabled('ponytail', true, home)
    expect((await enabledSkills(cwd, { home })).map((s) => s.name)).toEqual(['ponytail'])
  })
  it('/name runs a skill: the model is told to load it first and keeps the arguments; custom commands and built-ins win a name clash', async () => {
    const { home, cwd } = dirs()
    put(home, '.mca/skills/ponytail/SKILL.md', '---\ndescription: ride\n---\nb')
    put(home, '.mca/skills/clear/SKILL.md', '---\ndescription: clashes with a built-in\n---\nb')
    put(home, '.mca/skills/deploy/SKILL.md', '---\ndescription: skill\n---\nb')
    put(home, '.mca/commands/deploy.md', 'custom deploy')
    const custom = await loadCommands(cwd, { home })
    const p = parseInput('/ponytail fix the tests', custom)
    expect(p).toMatchObject({ kind: 'prompt' })
    expect((p as { text: string }).text).toContain('Load the "ponytail" skill with the Skill tool')
    expect((p as { text: string }).text).toContain('Arguments: fix the tests')
    expect(parseInput('/clear', custom)).toMatchObject({ kind: 'command', name: 'clear' })
    expect(parseInput('/deploy', custom)).toEqual({ kind: 'prompt', text: 'custom deploy' })
  })
})
