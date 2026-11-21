import { field, isTodo } from './guards'
import { isReminder, type EventBatch, type Item, type ViewEvent, type ViewState } from './types'

type Reduced = Pick<ViewState, 'items' | 'todos' | 'changes' | 'usage' | 'busy' | 'workspace' | 'mode' | 'mcp'>

export const emptyView = (): Reduced => ({ items: [], todos: [], changes: { turn: [], total: [] }, busy: false, workspace: null, mode: 'default', mcp: [] })

/** Pure: turns the event stream into what the transcript shows. Main and the renderer both run exactly this. */
export function reduce<S extends Reduced>(s: S, e: ViewEvent): S {
  const add = (i: Item): S => ({ ...s, items: [...s.items, i] })
  switch (e.type) {
    case 'turn_start':
      return { ...s, busy: true }
    case 'turn_end':
      return { ...s, busy: false }
    case 'user_message':
      return add({ kind: 'user', text: e.text, ...(e.attachments?.length && { attachments: e.attachments }) })
    case 'text_delta': {
      const last = s.items.at(-1)
      if (last?.kind === 'text' && last.parentId === e.parentId) return { ...s, items: [...s.items.slice(0, -1), { ...last, text: last.text + e.text }] }
      return add({ kind: 'text', text: e.text, ...(e.parentId && { parentId: e.parentId }) })
    }
    case 'tool_start':
      return add({ kind: 'tool', id: e.id, name: e.name, input: e.input, done: false, ...(e.parentId && { parentId: e.parentId }) })
    case 'tool_end':
      return { ...s, items: s.items.map((i) => (i.kind === 'tool' && i.id === e.id ? { ...i, done: true, result: e.result, isError: e.isError } : i)) }
    case 'todos':
      return { ...s, todos: e.todos }
    case 'changes':
      return { ...s, changes: { turn: e.turn, total: e.total } }
    case 'usage':
      return { ...s, usage: { contextTokens: e.contextTokens, contextWindow: e.contextWindow } }
    case 'notice':
      return add({ kind: 'notice', level: e.level, message: e.message })
    case 'rewind': {
      // drop the newest turn: everything from the last user message on (notices from commands before it stay)
      const at = s.items.map((i) => i.kind).lastIndexOf('user')
      return at < 0 ? s : { ...s, items: s.items.slice(0, at), changes: { turn: [], total: [] } }
    }
    case 'clear':
      return { ...s, items: [], todos: [], changes: { turn: [], total: [] }, usage: undefined, busy: false }
    case 'session':
      return { ...s, workspace: e.workspace, mode: e.mode, mcp: e.mcp ?? s.mcp }
  }
}

/** Renderer side: folds a batch into a snapshot-derived state. Batches already covered by the snapshot's seq are dropped. */
export function applyBatch(s: ViewState, b: EventBatch): ViewState {
  if (b.seq <= s.seq) return s
  const next = b.events.reduce(reduce, s)
  return { ...next, seq: b.seq, ...(b.events.some((e) => e.type === 'turn_end') && { pending: null }) }
}

type Msg = { role: 'user' | 'assistant'; content: ({ type: 'text'; text: string } | { type: 'image'; mime: string; data: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean })[] }

/** A saved transcript as the events that would have produced it, so a resumed chat goes through the same reducer as a live one. */
export function messagesToEvents(messages: Msg[]): ViewEvent[] {
  return messages.flatMap((m): ViewEvent[] =>
    m.content.flatMap((b): ViewEvent[] => {
      if (b.type === 'text') return m.role === 'user' && isReminder(b.text) ? [] : [m.role === 'user' ? { type: 'user_message', text: b.text } : { type: 'text_delta', text: b.text }]
      if (b.type === 'image') return []
      if (b.type === 'tool_use') {
        const start: ViewEvent = { type: 'tool_start', id: b.id, name: b.name, input: b.input }
        const todos = b.name === 'TodoWrite' ? field(b.input, 'todos') : undefined
        return Array.isArray(todos) ? [start, { type: 'todos', todos: todos.filter(isTodo) }] : [start] // the last TodoWrite of a saved chat is its current list
      }
      return [{ type: 'tool_end', id: b.tool_use_id, result: b.content, isError: !!b.is_error }]
    })
  )
}
