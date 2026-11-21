import { z } from 'zod'
import { SUBAGENT_TYPES, type Tool } from '../tool'

const schema = z.object({
  description: z.string().min(1).describe('Three to five words naming the task'),
  prompt: z.string().min(1).describe('Everything the subagent needs: it starts with no context from this conversation'),
  subagent_type: z.enum(SUBAGENT_TYPES).default('general-purpose')
})

export const Task: Tool<z.infer<typeof schema>> = {
  name: 'Task',
  description:
    'Delegate work to a subagent that has its own context and reports back with one final message. ' +
    '"Explore" is read-only (Read, Glob, Grep) and several Explore calls in one message run in parallel: use it to search or read widely. ' +
    '"general-purpose" can use every tool except Task and runs on its own. The subagent sees only your prompt, so include file paths and what to report.',
  schema,
  readOnly: (i) => i.subagent_type === 'Explore', // read-only calls run in parallel
  async run({ prompt, subagent_type }, ctx) {
    if (!ctx.runSubagent) throw new Error('Subagents cannot start other subagents.')
    return ctx.runSubagent({ type: subagent_type, prompt, callId: ctx.callId })
  }
}
