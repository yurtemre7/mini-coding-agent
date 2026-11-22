import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'
import { disabledSkills } from './trust'

export const MAX_DESCRIPTION = 200
export const MAX_SKILL_BODY = 40_000
const MAX_SKILLS = 300
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export type SkillSource = 'claude' | 'plugin' | 'antigravity' | 'mca' | 'project'

export interface Skill {
  name: string
  description: string
  dir: string
  file: string
  source: SkillSource
}

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)

interface Root {
  dir: string
  source: SkillSource
}

const SKIP = new Set(['node_modules', '.git'])

/** `skills` folders inside the Claude Code plugin store (their layout varies, so this looks a few levels deep and stops at a `skills` folder). */
async function pluginRoots(base: string): Promise<string[]> {
  const out: string[] = []
  let visited = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 7 || visited++ > 3000) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue
      if (e.name === 'skills') out.push(join(dir, e.name))
      else await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(base, 0)
  return out.sort()
}

/** Where skills live: `<dir>/<name>/SKILL.md`. Later roots win, so a project skill replaces a user skill of the same name. */
export async function skillRoots(cwd: string, home = homedir()): Promise<Root[]> {
  const plugins = (await pluginRoots(join(home, '.claude', 'plugins'))).map((dir): Root => ({ dir, source: 'plugin' }))
  return [
    ...plugins,
    { dir: join(home, '.claude', 'skills'), source: 'claude' },
    { dir: join(home, '.gemini', 'antigravity', 'skills'), source: 'antigravity' },
    { dir: join(home, '.mca', 'skills'), source: 'mca' },
    { dir: join(cwd, '.agent', 'skills'), source: 'antigravity' },
    { dir: join(cwd, '.claude', 'skills'), source: 'project' },
    { dir: join(cwd, '.mca', 'skills'), source: 'project' }
  ]
}

/** All skills with a valid name, enabled or not; a folder without a readable SKILL.md is skipped. Sorted by name. */
export async function discoverSkills(cwd: string, o: { home?: string } = {}): Promise<Skill[]> {
  const found = new Map<string, Skill>()
  for (const { dir: root, source } of await skillRoots(cwd, o.home)) {
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
        found.set(name, { name, description: clip(description.replace(/\s+/g, ' '), MAX_DESCRIPTION), dir: await realpath(dir), file, source })
      } catch {
        // not a skill folder
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS)
}

/** Skills the user has not switched off in Settings; these are the ones the model sees and `/name` runs. */
export async function enabledSkills(cwd: string, o: { home?: string } = {}): Promise<Skill[]> {
  const off = new Set(await disabledSkills(o.home))
  return (await discoverSkills(cwd, o)).filter((s) => !off.has(s.name))
}

/** The index sent with the first message: name and description only. The body is loaded on demand by the Skill tool. */
export const skillsIndex = (skills: Skill[]): string | undefined =>
  skills.length ? `Available skills (load one with the Skill tool before using it):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}` : undefined

export async function loadSkill(skill: Skill): Promise<string> {
  const { body } = parseFrontmatter(await readFile(skill.file, 'utf8'))
  const text = body.length > MAX_SKILL_BODY ? `${body.slice(0, MAX_SKILL_BODY)}\n… [truncated: ${body.length - MAX_SKILL_BODY} more characters]` : body
  return `Skill "${skill.name}". Its files are in ${skill.dir} (use Read for anything the instructions mention).\n\n${text}`
}
