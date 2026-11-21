import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import type { Todo } from '../../../shared/types'

const ICON = { pending: Circle, in_progress: CircleDot, completed: CheckCircle2 } as const

/** The agent's current todo list (TodoWrite), shown in the sidebar. */
export function TodoSidebar({ todos }: { todos: Todo[] }) {
  return (
    <section className="space-y-1" aria-label="Todos">
      <h2 className="text-xs font-medium uppercase text-muted-foreground">Todos</h2>
      {todos.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
      {todos.map((t, i) => {
        const Icon = ICON[t.status]
        return (
          <p key={i} data-status={t.status} className={'flex items-start gap-1.5 [overflow-wrap:anywhere] ' + (t.status === 'completed' ? 'text-muted-foreground line-through' : t.status === 'in_progress' ? 'font-medium' : '')}>
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{t.content}</span>
          </p>
        )
      })}
    </section>
  )
}
