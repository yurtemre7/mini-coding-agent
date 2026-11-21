import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'

export const MAX_DESCRIPTION = 200
export const MAX_SKILL_BODY = 40_000
const MAX_SKILLS = 100
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export interface Skill {
  name: string
  description: string
  dir: string
  file: string
}

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)

/** Where a skill lives: `<dir>/<name>/SKILL.md`. Later directories win, so a project skill replaces a user skill of the same name. */
export const skillDirs = (cwd: string, home = homedir()): string[] => [join(home, '.claude', 'skills'), join(home, '.mca', 'skills'), join(cwd, '.claude', 'skills'), join(cwd, '.mca', 'skills')]

/** Skills with a valid name; a folder without a readable SKILL.md is skipped. Sorted by name. */
export async function discoverSkills(cwd: string, o: { home?: string } = {}): Promise<Skill[]> {
  const found = new Map<string, Skill>()
  for (const root of skillDirs(cwd, o.home)) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(root, entry)
      const file = join(dir, 'SKILL.md')
      try {
        if (!(await stat(file)).isFile()) continue
        const { meta, body } = parseFrontmatter(await readFile(file, 'utf8'))
        const name = meta.name ?? entry
        if (!NAME.test(name)) continue
        const description = meta.description || body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() || '(no description)'
        found.set(name, { name, description: clip(description.replace(/\s+/g, ' '), MAX_DESCRIPTION), dir: await realpath(dir), file })
      } catch {
        // not a skill folder
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS)
}

/** The index sent with the first message: name and description only. The body is loaded on demand by the Skill tool. */
export const skillsIndex = (skills: Skill[]): string | undefined =>
  skills.length ? `Available skills (load one with the Skill tool before using it):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}` : undefined

export async function loadSkill(skill: Skill): Promise<string> {
  const { body } = parseFrontmatter(await readFile(skill.file, 'utf8'))
  const text = body.length > MAX_SKILL_BODY ? `${body.slice(0, MAX_SKILL_BODY)}\n… [truncated: ${body.length - MAX_SKILL_BODY} more characters]` : body
  return `Skill "${skill.name}". Its files are in ${skill.dir} (use Read for anything the instructions mention).\n\n${text}`
}
