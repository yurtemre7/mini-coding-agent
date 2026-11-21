import { ChevronDown, ChevronRight, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { ChangeSummary } from '../../../shared/types'
import { Button } from '@/components/ui/button'

type Scope = 'turn' | 'all'
const MARK = { added: 'A', modified: 'M', deleted: 'D' } as const

const lineClass = (line: string): string => (line.startsWith('+') && !line.startsWith('+++') ? 'text-green-600' : line.startsWith('-') && !line.startsWith('---') ? 'text-red-600' : line.startsWith('@@') ? 'text-muted-foreground' : '')

/** What the agent changed: this turn or the whole chat, one expandable unified diff per file, and a confirmed per-file revert. */
export function DiffPanel(p: { changes: { turn: ChangeSummary[]; total: ChangeSummary[] }; busy: boolean; loadDiff(scope: Scope, path: string): Promise<string>; onRevert(scope: Scope, path: string): Promise<void> }) {
  const [scope, setScope] = useState<Scope>('turn')
  const [open, setOpen] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const files = p.changes[scope === 'turn' ? 'turn' : 'total']

  const [seen, setSeen] = useState(p.changes)
  if (seen !== p.changes) {
    // new changes make cached diffs stale
    setSeen(p.changes)
    setDiffs({})
    setConfirm(null)
  }

  const toggle = async (path: string) => {
    if (open === path) return setOpen(null)
    setOpen(path)
    setError(null)
    if (diffs[`${scope}:${path}`] !== undefined) return
    try {
      const text = await p.loadDiff(scope, path)
      setDiffs((d) => ({ ...d, [`${scope}:${path}`]: text }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
      <div className="flex gap-1">
        {(['turn', 'all'] as const).map((s) => (
          <Button key={s} size="sm" variant={scope === s ? 'secondary' : 'ghost'} onClick={() => (setScope(s), setOpen(null), setConfirm(null))}>
            {s === 'turn' ? 'Turn' : 'All'}
          </Button>
        ))}
      </div>
      {files.length === 0 && <p className="text-xs text-muted-foreground">No changes yet.</p>}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {files.map((f) => {
          const key = `${scope}:${f.path}`
          return (
            <li key={key} className="rounded border">
              <div className="flex items-center gap-1 px-2 py-1">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => void toggle(f.path)}>
                  {open === f.path ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className="font-mono text-xs text-muted-foreground">{MARK[f.status]}</span>
                  <span className="min-w-0 truncate font-mono text-xs">{f.path}</span>
                </button>
                {f.binary && <span className="text-xs text-muted-foreground">binary</span>}
                {f.tooLarge && <span className="text-xs text-muted-foreground">too large</span>}
                <span className="text-xs text-green-600">+{f.additions}</span>
                <span className="text-xs text-red-600">-{f.deletions}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Revert ${f.path}`} disabled={p.busy} onClick={() => setConfirm(f.path)}>
                  <Undo2 className="h-3 w-3" />
                </Button>
              </div>
              {confirm === f.path && (
                <div className="space-y-2 border-t px-2 py-2">
                  <p className="text-xs [overflow-wrap:anywhere]">Revert {f.path} to its state before the agent changed it? Edits you made since will be lost.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={p.busy} onClick={() => void p.onRevert(scope, f.path).finally(() => setConfirm(null))}>
                      Confirm revert
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {open === f.path && (
                <pre className="max-h-80 overflow-auto border-t bg-muted/30 p-2 font-mono text-xs">
                  {error ? (
                    <span className="text-destructive">{error}</span>
                  ) : diffs[key] === undefined ? (
                    'Loading…'
                  ) : (
                    diffs[key].split('\n').map((line, i) => (
                      <div key={i} className={lineClass(line)}>
                        {line || ' '}
                      </div>
                    ))
                  )}
                </pre>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
