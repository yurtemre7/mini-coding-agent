import { useCallback, useEffect, useState } from 'react'
import { applyBatch } from '../../../shared/reducer'
import type { Attachment, Decision, McaApi, ViewState } from '../../../shared/types'

/** Main owns the conversation: mount asks for a snapshot, then the batched event stream is folded in with the same reducer main uses. */
export function useAgentSession(api: McaApi | undefined = window.mca) {
  const [state, setState] = useState<ViewState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    api.invoke('session:getState').then(setState, (e: Error) => setError(e.message))
    const offEvents = api.on('agent:events', (batch) => setState((s) => s && applyBatch(s, batch)))
    const offPrompt = api.on('prompt:request', (pending) => setState((s) => s && { ...s, pending }))
    return () => (offEvents(), offPrompt())
  }, [api])

  // every action returns main's fresh snapshot; failures (busy, no workspace...) surface as an error banner
  const call = useCallback(
    async (run: (a: McaApi) => Promise<unknown>) => {
      if (!api) return
      setError(null)
      try {
        await run(api)
      } catch (e) {
        setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    },
    [api]
  )

  return {
    state,
    error,
    send: (text: string, files?: Attachment[]) => call((a) => a.invoke('session:send', text, files)),
    command: (line: string) => call((a) => a.invoke('session:command', line)),
    abort: () => call((a) => a.invoke('session:abort')),
    selectWorkspace: () => call((a) => a.invoke('workspace:select')),
    openWorkspace: (path: string) => call((a) => a.invoke('workspace:open', path)),
    openChat: (id: string) => call((a) => a.invoke('session:open', id)),
    newChat: () => call((a) => a.invoke('session:new')),
    answer: (id: string, d: Decision) => {
      setState((s) => s && { ...s, pending: null })
      return api?.invoke('prompt:answer', id, d).catch(() => {}) // an answer that lost the race with an abort is moot
    },
    /** A snapshot carries its seq, so batches it already includes are dropped by applyBatch. */
    refresh: () => api?.invoke('session:getState').then(setState, (e: Error) => setError(e.message))
  }
}
