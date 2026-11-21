import type { ViewEvent } from '../shared/types'

/** Queues events and flushes them in one IPC message every `ms`; consecutive text deltas (same parent) merge into one. Electron-free. */
export function createBatcher(send: (events: ViewEvent[]) => void, ms = 30) {
  let queue: ViewEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!queue.length) return
    const out = queue
    queue = []
    send(out)
  }
  return {
    push(e: ViewEvent) {
      const last = queue.at(-1)
      if (e.type === 'text_delta' && last?.type === 'text_delta' && last.parentId === e.parentId) last.text += e.text
      else queue.push(e.type === 'text_delta' ? { ...e } : e)
      timer ??= setTimeout(flush, ms)
    },
    flush,
    dispose() {
      clearTimeout(timer)
      timer = undefined
      queue = []
    }
  }
}
