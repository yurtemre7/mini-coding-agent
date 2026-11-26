import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, ExternalLink, Folder, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2, X } from 'lucide-react'
import type { WorkspaceChats } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ago } from '@/lib/ago'

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p
const KEY = 'mca.collapsed'
const load = (): Record<string, boolean> => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** A pin lasts for this app session; pinning it again ("Keep pinned") saves it across restarts. */
type PinRef = { path: string; id: string; saved: boolean }
const PIN_KEY = 'mca.pinned'
const read = (store: () => Storage, saved: boolean): PinRef[] => {
  try {
    const v = JSON.parse(store().getItem(PIN_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((r) => !!r && typeof r.path === 'string' && typeof r.id === 'string').map((r) => ({ path: r.path, id: r.id, saved })) : []
  } catch {
    return []
  }
}
const loadPins = (): PinRef[] => [...read(() => localStorage, true), ...read(() => sessionStorage, false)]
const savePins = (pins: PinRef[]) => {
  const strip = (saved: boolean) => JSON.stringify(pins.filter((r) => r.saved === saved).map(({ path, id }) => ({ path, id })))
  try {
    localStorage.setItem(PIN_KEY, strip(true))
    sessionStorage.setItem(PIN_KEY, strip(false))
  } catch {
    // not remembered
  }
}

/** Moves `from` next to `to` (before it when dragging up, after it when dragging down). */
function moved(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0 || a === b) return order
  const out = order.filter((p) => p !== from)
  out.splice(out.indexOf(to) + (a < b ? 1 : 0), 0, from)
  return out
}

interface Props {
  workspaces: WorkspaceChats[]
  /** The open workspace. */
  workspace: string | null
  /** The open chat. */
  current?: string
  disabled: boolean
  onNewWorkspace(): void
  /** Newest folders created next to the listed workspaces; shown while "New workspace" is hovered. */
  newest?: string[]
  /** Called when "New workspace" is hovered, to refresh `newest`. */
  onNewestHover?(): void
  onReorder(order: string[]): void
  /** Opens another workspace (its newest chat continues). */
  onWorkspace(path: string): void
  onForget(path: string): void
  onReveal?(): void
  /** Opens the chat; the workspace is opened first when it is not the open one. */
  onChat(path: string, id: string): void
  onNew(path: string): void
  onDelete?(id: string): void
  /** Double-click on a chat: it is opened and the message field gets the cursor. */
  onActivate?(path: string, id: string): void
  /** "Rename" in a chat's menu edits its title in place. */
  onRename?(id: string, title: string): void
  onExport?(id: string): void
}

/** Workspaces as collapsible tiles (reorderable by drag and drop or the menu), each holding its saved chats. Everything is disabled while a turn runs. */
export function ChatsSidebar(p: Props) {
  const [collapsed, setCollapsed] = useState(load)
  // pinned chats (any workspace) are listed on top; a pin whose chat no longer exists is simply not shown
  const [pins, setPins] = useState(loadPins)
  const pinOf = (path: string, id: string) => pins.find((r) => r.path === path && r.id === id)
  const isPinned = (path: string, id: string) => !!pinOf(path, id)
  const update = (f: (cur: PinRef[]) => PinRef[]) =>
    setPins((cur) => {
      const next = f(cur)
      savePins(next)
      return next
    })
  const same = (r: PinRef, path: string, id: string) => r.path === path && r.id === id
  /** Not pinned: pin for this session. Pinned: unpin. */
  const togglePin = (path: string, id: string) => update((cur) => (cur.some((r) => same(r, path, id)) ? cur.filter((r) => !same(r, path, id)) : [...cur, { path, id, saved: false }]))
  /** Pin again: keep it after restarts. */
  const keepPin = (path: string, id: string) => update((cur) => cur.map((r) => (same(r, path, id) ? { ...r, saved: true } : r)))
  const pinned = pins.flatMap((r) => {
    const chat = p.workspaces.find((w) => w.path === r.path)?.chats.find((c) => c.id === r.id)
    return chat ? [{ ...r, chat }] : []
  })
  const [menu, setMenu] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const order = p.workspaces.map((w) => w.path)
  // the open workspace starts expanded, the others collapsed; the user's own choice wins
  const isCollapsed = (path: string) => collapsed[path] ?? path !== p.workspace
  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = { ...c, [path]: !isCollapsed(path) }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // private mode or blocked storage: the choice just is not remembered
      }
      return next
    })
  const move = (path: string, by: -1 | 1) => {
    const i = order.indexOf(path)
    const j = i + by
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    p.onReorder(next)
  }

  return (
    <div className="space-y-2">
      {/* hovering "New workspace" lists the newest folders created next to the listed workspaces */}
      <div className="group/new" onMouseEnter={p.onNewestHover}>
        <Button variant="outline" size="sm" className="w-full" disabled={p.disabled} onClick={p.onNewWorkspace}>
          <FolderPlus className="mr-1 h-4 w-4" />
          New workspace
        </Button>
        {!!p.newest?.length && (
          <div className="hidden space-y-0.5 pt-1 group-hover/new:block group-focus-within/new:block">
            <p className="px-2 text-xs text-muted-foreground">Newest folders</p>
            {p.newest.map((f) => (
              <Button key={f} variant="ghost" size="sm" className="h-7 w-full justify-start text-xs" disabled={p.disabled} title={f} aria-label={`Open newest folder ${base(f)}`} onClick={() => p.onWorkspace(f)}>
                <Folder className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{base(f)}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
      {pinned.length > 0 && (
        <section aria-label="Pinned" className="space-y-0.5">
          <p className="px-2 text-xs font-medium text-muted-foreground">Pinned</p>
          {pinned.map(({ path, id, chat, saved }) => {
            const here = path === p.workspace && id === p.current
            return (
              <div key={`${path}:${id}`} className={`group relative flex items-center rounded-md ${here ? 'bg-accent text-accent-foreground' : ''}`}>
                <Button variant="ghost" size="sm" className="h-7 min-w-0 flex-1 justify-start text-left hover:bg-transparent" disabled={p.disabled} title={`${chat.title} (${base(path)})${saved ? '' : ', pinned for this session'}`} onClick={() => p.onChat(path, id)} onDoubleClick={() => p.onActivate?.(path, id)}>
                  <Pin className={`mr-1 h-3 w-3 shrink-0 ${saved ? 'fill-current' : 'opacity-60'}`} aria-label={saved ? 'Saved pin' : 'Session pin'} />
                  <span className={`min-w-0 truncate ${here ? 'font-medium' : ''}`}>{chat.title}</span>
                </Button>
                {!saved && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Keep "${chat.title}" pinned`} title="Pin again to keep it after restarts" onClick={() => keepPin(path, id)}>
                    <Pin className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Unpin "${chat.title}"`} title="Unpin" onClick={() => togglePin(path, id)}>
                  <PinOff className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </section>
      )}
      {p.workspaces.length === 0 && <p className="text-xs text-muted-foreground">No workspaces yet. Open a folder to start.</p>}
      <ul className="space-y-1">
        {p.workspaces.map(({ path, chats }, i) => {
          const open = path === p.workspace
          const shut = isCollapsed(path)
          return (
            <li
              key={path}
              data-testid={`workspace-${base(path)}`}
              className={`rounded-md border ${open ? 'border-border bg-surface' : 'border-transparent'} ${over === path && drag && drag !== path ? 'ring-2 ring-primary/50' : ''}`}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                setOver(path)
              }}
              onDragLeave={() => setOver((o) => (o === path ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                if (drag && drag !== path) p.onReorder(moved(order, drag, path))
                setDrag(null)
                setOver(null)
              }}
            >
              <div className="group flex items-center" draggable={!p.disabled} onDragStart={(e) => {
                setDrag(path)
                e.dataTransfer?.setData('text/plain', path)
              }} onDragEnd={() => { setDrag(null); setOver(null) }}>
                <Button variant="ghost" size="icon" className="h-7 w-6 shrink-0" aria-expanded={!shut} aria-label={`${shut ? 'Expand' : 'Collapse'} ${base(path)}`} onClick={() => toggle(path)}>
                  {shut ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start px-1" disabled={p.disabled} title={path} onClick={() => (open ? toggle(path) : (shut && toggle(path), p.onWorkspace(path)))}>
                  <Folder className="mr-1 h-4 w-4 shrink-0" />
                  <span className={`min-w-0 truncate ${open ? 'font-medium' : ''}`}>{base(path)}</span>
                </Button>
                <Popover open={menu === path} onOpenChange={(o) => setMenu(o ? path : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className={`mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${menu === path ? 'opacity-100' : ''}`} aria-label={`Actions for ${base(path)}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-60 p-1">
                    <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" disabled={p.disabled || i === 0} onClick={() => { setMenu(null); move(path, -1) }}>
                      <ArrowUp className="mr-2 h-3.5 w-3.5" />
                      Move up
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" disabled={p.disabled || i === p.workspaces.length - 1} onClick={() => { setMenu(null); move(path, 1) }}>
                      <ArrowDown className="mr-2 h-3.5 w-3.5" />
                      Move down
                    </Button>
                    {open && p.onReveal && (
                      <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" onClick={() => { setMenu(null); p.onReveal?.() }}>
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Show in Finder
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" aria-label={`Remove ${base(path)} from the list`} title="Removes it from this list only; the folder and its chats are kept" disabled={p.disabled || open} onClick={() => { setMenu(null); p.onForget(path) }}>
                      <X className="mr-2 h-3.5 w-3.5" />
                      Remove from the list
                    </Button>
                    {open && <p className="px-2 pb-1 text-xs text-muted-foreground">The open workspace cannot be removed. Open another one first.</p>}
                  </PopoverContent>
                </Popover>
              </div>
              {!shut && (
                <div className="space-y-1 px-1 pb-1">
                  <Button variant="ghost" size="sm" className="h-7 w-full justify-start text-muted-foreground" disabled={p.disabled} aria-label={`New chat in ${base(path)}`} onClick={() => p.onNew(path)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    New chat
                  </Button>
                  {chats.length === 0 && <p className="px-2 text-xs text-muted-foreground">No saved chats yet.</p>}
                  {chats.map((c) => {
                    const here = open && c.id === p.current
                    if (open && confirm === c.id)
                      return (
                        <div key={c.id} className="space-y-1 rounded-md border p-2 text-xs">
                          <p className="[overflow-wrap:anywhere]">Delete &quot;{c.title}&quot;? This cannot be undone.</p>
                          <div className="flex gap-1">
                            <Button size="sm" variant="destructive" className="h-7" onClick={() => { setConfirm(null); p.onDelete?.(c.id) }}>
                              Delete chat
                            </Button>
                            <Button size="sm" variant="outline" className="h-7" onClick={() => setConfirm(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )
                    if (open && edit?.id === c.id) {
                      const done = (save: boolean) => {
                        const title = edit.value.replace(/\s+/g, ' ').trim()
                        setEdit(null)
                        if (save && title && title !== c.title) p.onRename?.(c.id, title)
                      }
                      return (
                        <div key={c.id} className="px-1 py-0.5">
                          <Input
                            autoFocus
                            aria-label={`Rename "${c.title}"`}
                            className="h-7 text-sm"
                            maxLength={80}
                            value={edit.value}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setEdit({ id: c.id, value: e.target.value })}
                            onBlur={() => done(true)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') done(true)
                              else if (e.key === 'Escape') done(false)
                            }}
                          />
                        </div>
                      )
                    }
                    return (
                      <div key={c.id} className={`group relative flex items-center rounded-md ${here ? 'bg-accent text-accent-foreground' : ''}`} aria-current={here ? 'true' : undefined}>
                        {here && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />}
                        <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start py-1 text-left hover:bg-transparent" disabled={p.disabled} title={c.title} onClick={() => p.onChat(path, c.id)} onDoubleClick={() => p.onActivate?.(path, c.id)}>
                          <MessageSquare className="mr-1 h-3 w-3 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate ${here ? 'font-medium' : ''}`}>{c.title}</span>
                            <span className="block text-xs font-normal text-muted-foreground">{ago(c.updated)}</span>
                          </span>
                        </Button>
                        <Button variant="ghost" size="icon" className={`h-6 w-6 shrink-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${isPinned(path, c.id) ? 'opacity-60' : 'opacity-0'}`} aria-label={isPinned(path, c.id) ? `Unpin "${c.title}"` : `Pin "${c.title}"`} title={isPinned(path, c.id) ? 'Unpin' : 'Pin'} aria-pressed={isPinned(path, c.id)} onClick={() => togglePin(path, c.id)}>
                          {isPinned(path, c.id) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </Button>
                        {open && (p.onExport || p.onDelete || p.onRename) && (
                          <Popover open={menu === c.id} onOpenChange={(o) => setMenu(o ? c.id : null)}>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className={`mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${menu === c.id ? 'opacity-100' : ''}`} aria-label={`Actions for "${c.title}"`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-56 p-1">
                              {pinOf(path, c.id)?.saved === false && (
                                <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" onClick={() => { setMenu(null); keepPin(path, c.id) }}>
                                  <Pin className="mr-2 h-3.5 w-3.5 fill-current" />
                                  Keep pinned
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" onClick={() => { setMenu(null); togglePin(path, c.id) }}>
                                {isPinned(path, c.id) ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
                                {isPinned(path, c.id) ? 'Unpin' : 'Pin for this session'}
                              </Button>
                              {p.onRename && (
                                <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" aria-label={`Rename "${c.title}"`} onClick={() => { setMenu(null); setEdit({ id: c.id, value: c.title }) }}>
                                  <Pencil className="mr-2 h-3.5 w-3.5" />
                                  Rename
                                </Button>
                              )}
                              {p.onExport && (
                                <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap" aria-label={`Export "${c.title}" as Markdown`} onClick={() => { setMenu(null); p.onExport?.(c.id) }}>
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export as Markdown
                                </Button>
                              )}
                              {p.onDelete && (
                                <Button variant="ghost" size="sm" className="w-full justify-start whitespace-nowrap text-destructive hover:text-destructive" aria-label={`Delete "${c.title}"`} disabled={p.disabled} onClick={() => { setMenu(null); setConfirm(c.id) }}>
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete chat…
                                </Button>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
