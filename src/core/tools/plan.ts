import { z } from 'zod'
import type { Tool } from '../tool'

const schema = z.object({ plan: z.string().min(1).describe('The plan, in Markdown: what you will change and in which order') })

export const ExitPlanMode: Tool<z.infer<typeof schema>> = {
  name: 'ExitPlanMode',
  description:
    'In plan mode only: present your plan to the user for approval. Explore with read-only tools first. ' +
    'If the user approves, plan mode ends and you can make changes. If they reject it, revise the plan from their feedback.',
  schema,
  readOnly: true,
  async run({ plan }, ctx) {
    if (ctx.plan?.mode !== 'plan') throw new Error('ExitPlanMode only works in plan mode. You can already make changes.')
    const d = await ctx.ask({ kind: 'plan', plan })
    if (!d.allow) {
      if (ctx.signal.aborted) throw new Error('Aborted.')
      return `The user rejected the plan${d.feedback ? ` and said: ${d.feedback}` : '.'} Revise it and present it again with ExitPlanMode. Plan mode stays on.`
    }
    const mode = ctx.plan.exitPlan()
    return `The user approved the plan. Plan mode is off (mode: ${mode}). Carry out the plan now.`
  }
}
