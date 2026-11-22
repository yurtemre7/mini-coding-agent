import { z } from 'zod'
import { enabledSkills, loadSkill } from '../skill'
import type { Tool } from '../tool'

const schema = z.object({ name: z.string().min(1).describe('The skill name from the "Available skills" list') })

export const Skill: Tool<z.infer<typeof schema>> = {
  name: 'Skill',
  description: 'Load a skill: written instructions (and files) for a specific kind of task. The available skills are listed at the start of the conversation. Call this before doing the task the skill covers, then follow it.',
  schema,
  readOnly: true,
  async run({ name }, ctx) {
    const skills = await enabledSkills(ctx.root)
    const skill = skills.find((s) => s.name === name)
    if (!skill) throw new Error(`Unknown skill "${name}". ${skills.length ? `Available: ${skills.map((s) => s.name).join(', ')}.` : 'No skills are installed.'}`)
    return loadSkill(skill)
  }
}
