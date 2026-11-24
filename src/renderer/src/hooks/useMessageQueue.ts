import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/types'

export interface QueuedMessage {
  id: number
  text: string
  files?: Attachment[]
}

interface Options {
  /** True while a turn runs; the queue only drains when it is false. */
  busy: boolean
  /** Identifies the open chat; another chat or workspace starts with an empty queue. */
  scope: string
  /** Sends one message and resolves once main has accepted it and the view is up to date (so `busy` is already true). */
  dispatch(text: string, files?: Attachment[]): Promise<unknown>
}

/** Messages typed while the agent works wait here and go out one per finished turn, in order. */
export function useMessageQueue({ busy, scope, dispatch }: Options) {
  const [items, setItems] = useState<QueuedMessage[]>([])
  const [sending, setSending] = useState(false)
  const [seenScope, setSeenScope] = useState(scope)
  const nextId = useRef(0)
  if (seenScope !== scope) {
    setSeenScope(scope)
    setItems([])
  }

  useEffect(() => {
    if (busy || sending || !items.length) return
    const [first, ...rest] = items
    // one step of a small state machine (idle, then sending, then idle again), guarded by `sending`, so it cannot loop
    /* eslint-disable react-hooks/set-state-in-effect */
    setItems(rest)
    setSending(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    void dispatch(first.text, first.files).finally(() => setSending(false))
  }, [busy, sending, items, dispatch])

  return {
    items,
    add: (text: string, files?: Attachment[]) => setItems((q) => [...q, { id: nextId.current++, text, files }]),
    remove: (id: number) => setItems((q) => q.filter((m) => m.id !== id)),
    clear: () => setItems([])
  }
}
