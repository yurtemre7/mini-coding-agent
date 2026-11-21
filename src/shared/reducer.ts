import type { Item, ViewEvent, ViewState } from './types'

type Reduced = Pick<ViewState, 'items' | 'todos' | 'usage' | 'busy'>

export const emptyView = (): Reduced => ({ items: [], todos: [], busy: false })

/** Pure: turns the event stream into what the transcript shows. Main and the renderer both run exactly this. */
export function reduce<S extends Reduced>(s: S, e: ViewEvent): S {
  const add = (i: Item): S => ({ ...s, items: [...s.items, i] })
  switch (e.type) {
    case 'turn_start':
      return { ...s, busy: true }
    case 'turn_end':
      return { ...s, busy: false }
    case 'user_message':
      return add({ kind: 'user', text: e.text })
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
    case 'usage':
      return { ...s, usage: { contextTokens: e.contextTokens, contextWindow: e.contextWindow } }
    case 'notice':
      return add({ kind: 'notice', level: e.level, message: e.message })
    case 'rewind': {
      // drop the newest turn: everything from the last user message on (notices from commands before it stay)
      const at = s.items.map((i) => i.kind).lastIndexOf('user')
      return at < 0 ? s : { ...s, items: s.items.slice(0, at) }
    }
    case 'clear':
      return { ...s, ...emptyView() }
  }
}
