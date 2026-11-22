import { useEffect, useRef, useState } from 'react'
import { Eraser, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Runs one shell command at a time in the workspace. Output is plain text; interactive programs (vim, ssh) are not supported. */
export function TerminalPanel(p: { log: string; running: boolean; hasWorkspace: boolean; onRun(command: string): void; onStop(): void; onClear(): void }) {
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [at, setAt] = useState(-1)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [p.log])

  const run = () => {
    const c = cmd.trim()
    if (!c || p.running) return
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50))
    setAt(-1)
    setCmd('')
    p.onRun(c)
  }
  const recall = (dir: 1 | -1) => {
    const n = Math.max(-1, Math.min(history.length - 1, at + dir))
    setAt(n)
    setCmd(n === -1 ? '' : history[n])
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
      <pre aria-label="Terminal output" className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all">
        {p.log || <span className="text-muted-foreground">{p.hasWorkspace ? 'Run a command in the workspace. Not a full terminal: interactive programs are not supported.' : 'Open a workspace to use the terminal.'}</span>}
        <div ref={end} />
      </pre>
      <div className="flex gap-1">
        <Input
          aria-label="Command"
          className="font-mono text-xs"
          placeholder="npm test"
          value={cmd}
          disabled={!p.hasWorkspace}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run()
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              recall(e.key === 'ArrowUp' ? 1 : -1)
            }
          }}
        />
        {p.running ? (
          <Button size="sm" variant="destructive" onClick={p.onStop}>
            <Square className="mr-1 h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={!cmd.trim() || !p.hasWorkspace} onClick={run}>
            <Play className="mr-1 h-3 w-3" />
            Run
          </Button>
        )}
        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label="Clear output" title="Clear output" disabled={!p.log} onClick={p.onClear}>
          <Eraser className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
