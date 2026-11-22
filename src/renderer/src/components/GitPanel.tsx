import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitBranch, Minus, Plus, RefreshCw } from 'lucide-react'
import type { GitBranches, GitFile, GitStatus, McaApi } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DiffText } from './DiffText'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const CODE: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: '!', '?': 'U' }

type Msg = { tone: 'ok' | 'error'; text: string } | null

/** Git for the open workspace: branch switch/create, stage, per-file diff, commit and push. Push is never forced. `refreshKey` reloads after the agent finishes. */
export function GitPanel({ api, workspace, busy, refreshKey }: { api: McaApi; workspace: string | null; busy: boolean; refreshKey: unknown }) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranches>({ current: null, branches: [] })
  const [open, setOpen] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [note, setNote] = useState<Msg>(null)
  const [working, setWorking] = useState(false)

  const reload = useCallback(async () => {
    if (!workspace) return
    const [s, b] = await Promise.all([api.invoke('git:status'), api.invoke('git:branches')])
    setStatus(s)
    setBranches(b)
  }, [api, workspace])
  useEffect(() => {
    if (!workspace) return
    let live = true
    Promise.all([api.invoke('git:status'), api.invoke('git:branches')]).then(
      ([st, br]) => live && (setStatus(st), setBranches(br)),
      (e) => live && setNote({ tone: 'error', text: clean(e) })
    )
    return () => {
      live = false
    }
  }, [api, workspace, refreshKey])

  const act = async (run: () => Promise<string | void>) => {
    setWorking(true)
    setNote(null)
    try {
      const text = await run()
      if (text) setNote({ tone: 'ok', text })
      setOpen(null)
      await reload()
    } catch (e) {
      setNote({ tone: 'error', text: clean(e) })
    } finally {
      setWorking(false)
    }
  }

  const show = async (f: GitFile, staged: boolean) => {
    const key = `${staged ? 's' : 'w'}:${f.path}`
    if (open === key) return setOpen(null)
    setOpen(key)
    setDiff(null)
    try {
      setDiff(await api.invoke('git:diff', f.path, staged))
    } catch (e) {
      setDiff(clean(e))
    }
  }

  if (!workspace) return <p className="text-xs text-muted-foreground">Open a workspace to see its git status.</p>
  if (!status) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (!status.repo) return <p className="text-xs text-muted-foreground">This workspace is not a git repository. Run <code>git init</code> in the terminal to start one.</p>

  const staged = status.files.filter((f) => f.index)
  const unstaged = status.files.filter((f) => f.worktree)
  const locked = busy || working
  const row = (f: GitFile, isStaged: boolean) => {
    const key = `${isStaged ? 's' : 'w'}:${f.path}`
    return (
      <li key={key} className="rounded border">
        <div className="flex items-center gap-1 px-2 py-1">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => void show(f, isStaged)}>
            {open === key ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className="font-mono text-xs text-muted-foreground">{CODE[isStaged ? f.index : f.worktree] ?? '?'}</span>
            <span className="min-w-0 truncate font-mono text-xs" title={f.path}>{f.path}</span>
          </button>
          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${f.path}`} disabled={locked} onClick={() => void act(() => api.invoke('git:stage', [f.path], !isStaged))}>
            {isStaged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
        {open === key && <div className="max-h-72 overflow-auto border-t bg-muted/30 p-2">{diff === null ? <span className="text-xs">Loading…</span> : <DiffText text={diff} />}</div>}
      </li>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-sm">
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <GitBranch className="h-4 w-4 shrink-0" aria-hidden />
          <select aria-label="Branch" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" value={branches.current ?? ''} disabled={locked} onChange={(e) => void act(() => api.invoke('git:switch', e.target.value, false))}>
            {!branches.current && <option value="">(detached)</option>}
            {branches.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {status.upstream && (
            <span className="flex shrink-0 items-center text-xs text-muted-foreground" title={`vs ${status.upstream}`}>
              <ArrowUp className="h-3 w-3" />{status.ahead}
              <ArrowDown className="ml-1 h-3 w-3" />{status.behind}
            </span>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Refresh git status" disabled={working} onClick={() => void reload()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex gap-1">
          <Input aria-label="New branch name" className="h-8 min-w-0 flex-1 text-xs" placeholder="new-branch-name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
          <Button size="sm" variant="outline" disabled={locked || !newBranch.trim()} onClick={() => void act(async () => { await api.invoke('git:switch', newBranch.trim(), true); setNewBranch('') })}>
            Create branch
          </Button>
        </div>
      </div>

      <section className="space-y-1" aria-label="Staged changes">
        <h3 className="flex items-center justify-between text-xs font-medium uppercase text-muted-foreground">Staged ({staged.length})</h3>
        {staged.length === 0 && <p className="text-xs text-muted-foreground">Nothing staged.</p>}
        <ul className="space-y-1">{staged.map((f) => row(f, true))}</ul>
      </section>
      <section className="space-y-1" aria-label="Unstaged changes">
        <h3 className="flex items-center justify-between text-xs font-medium uppercase text-muted-foreground">
          Changes ({unstaged.length})
          {unstaged.length > 0 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs normal-case" disabled={locked} onClick={() => void act(() => api.invoke('git:stage', unstaged.map((f) => f.path), true))}>
              Stage all
            </Button>
          )}
        </h3>
        {unstaged.length === 0 && <p className="text-xs text-muted-foreground">Working tree clean.</p>}
        <ul className="space-y-1">{unstaged.map((f) => row(f, false))}</ul>
      </section>

      <div className="space-y-2">
        <Textarea aria-label="Commit message" className="min-h-16 text-xs" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="flex gap-1">
          <Button size="sm" disabled={locked || !staged.length || !message.trim()} onClick={() => void act(async () => `Committed ${await api.invoke('git:commit', message)}`.trim()).then(() => setMessage(''))}>
            Commit
          </Button>
          <Button size="sm" variant="outline" disabled={locked || !status.branch} title={status.upstream ? `Push to ${status.upstream}` : 'Push and set the upstream on origin'} onClick={() => void act(() => api.invoke('git:push'))}>
            Push{status.ahead ? ` (${status.ahead})` : ''}
          </Button>
        </div>
        {note && (
          <p role="status" className={`max-h-24 overflow-auto text-xs whitespace-pre-wrap [overflow-wrap:anywhere] ${note.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{note.text}</p>
        )}
      </div>
    </div>
  )
}
