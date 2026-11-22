import { useCallback, useEffect, useState } from 'react'
import type { McaApi } from '../../../shared/types'

const MAX = 200_000

/** Terminal scrollback lives here (not in the panel) so it survives switching tabs or hiding the panel. */
export function useTerminal(api: McaApi | undefined = window.mca) {
  const [log, setLog] = useState('')
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!api) return
    return api.on('terminal:event', (e) => {
      if (e.type === 'start') {
        setRunning(true)
        setLog((l) => `${l}$ ${e.command}\n`.slice(-MAX))
      } else if (e.type === 'out') setLog((l) => (l + e.text).slice(-MAX))
      else {
        setRunning(false)
        setLog((l) => `${l}${l.endsWith('\n') ? '' : '\n'}[${e.signal ? `stopped (${e.signal})` : `exit ${e.code}`}]\n\n`.slice(-MAX))
      }
    })
  }, [api])
  const run = useCallback((command: string) => api?.invoke('terminal:run', command).catch((e: Error) => setLog((l) => `${l}${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}\n`)), [api])
  const kill = useCallback(() => void api?.invoke('terminal:kill').catch(() => {}), [api])
  return { log, running, run, kill, clear: () => setLog('') }
}
