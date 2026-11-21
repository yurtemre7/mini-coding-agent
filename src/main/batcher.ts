import type { EventBatch, ViewEvent } from '../shared/types'

/** Queues events and flushes them in one IPC message every `ms`; consecutive text deltas (same parent) merge into one. Electron-free. */
export function createBatcher(send: (batch: EventBatch) => void, ms = 30) {
  let queue: ViewEvent[] = []
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!queue.length) return
    const out = queue
    queue = []
    send({ seq, events: out })
  }
  return {
    push(e: ViewEvent, eventSeq: number) {
      seq = eventSeq
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
