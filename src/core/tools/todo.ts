import { z } from 'zod'
import type { Tool } from '../tool'

const schema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1).describe('What needs to be done, in the imperative ("Run the tests")'),
        status: z.enum(['pending', 'in_progress', 'completed'])
      })
    )
    .describe('The complete todo list. It replaces the previous list.')
})

export const TodoWrite: Tool<z.infer<typeof schema>> = {
  name: 'TodoWrite',
  description:
    'Track progress on a multi-step task. Send the COMPLETE list every time (it replaces the previous one). ' +
    'Keep exactly one item in_progress, and mark items completed as soon as they are done. Skip it for trivial tasks.',
  schema,
  readOnly: true, // only changes the on-screen list
  async run({ todos }, ctx) {
    ctx.emit({ type: 'todos', todos })
    const active = todos.filter((t) => t.status === 'in_progress').length
    return active > 1 ? `Todos updated, but ${active} items are in_progress. Keep only one in progress at a time.` : 'Todos updated.'
  }
}
