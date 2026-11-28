import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, ExternalLink, Folder, FolderOpen, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import type { WorkspaceChats } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const chatCount = p.workspaces.reduce((n, w) => n + w.chats.length, 0)
  // a workspace whose name matches shows all its chats; otherwise only the chats whose title matches
  const shown = q
    ? p.workspaces.flatMap((w) => {
        if (base(w.path).toLowerCase().includes(q)) return [w]
        const chats = w.chats.filter((c) => c.title.toLowerCase().includes(q))
        return chats.length ? [{ ...w, chats }] : []
      })
    : p.workspaces
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
      {(chatCount >= 6 || q) && (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search chats" placeholder="Search chats" className="h-8 pr-7 pl-7 text-xs" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          {query && (
            <Button variant="ghost" size="icon" className="absolute top-1/2 right-0.5 h-6 w-6 -translate-y-1/2" aria-label="Clear search" onClick={() => setQuery('')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
      {pinned.length > 0 && !q && (
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
      {q && shown.length === 0 && <p role="status" className="px-2 text-xs text-muted-foreground">Nothing matches &quot;{query.trim()}&quot;.</p>}
      <ul className="space-y-1">
        {shown.map(({ path, chats }) => {
          const i = order.indexOf(path)
          const open = path === p.workspace
          const shut = q ? false : isCollapsed(path)
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
                  {open ? <FolderOpen className="mr-1 h-4 w-4 shrink-0 text-primary" /> : <Folder className="mr-1 h-4 w-4 shrink-0" />}
                  <span className={`min-w-0 truncate ${open ? 'font-medium' : ''}`}>{base(path)}</span>
                </Button>
                {chats.length > 0 && <span aria-hidden className="shrink-0 pr-1 text-xs text-muted-foreground tabular-nums">{chats.length}</span>}
                <DropdownMenu open={menu === path} onOpenChange={(o) => setMenu(o ? path : null)}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className={`mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${menu === path ? 'opacity-100' : ''}`} aria-label={`Actions for ${base(path)}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem disabled={p.disabled || i === 0} onSelect={() => move(path, -1)}>
                      <ArrowUp />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={p.disabled || i === p.workspaces.length - 1} onSelect={() => move(path, 1)}>
                      <ArrowDown />
                      Move down
                    </DropdownMenuItem>
                    {open && p.onReveal && (
                      <DropdownMenuItem onSelect={() => p.onReveal?.()}>
                        <ExternalLink />
                        Show in Finder
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem aria-label={`Remove ${base(path)} from the list`} title="Removes it from this list only; the folder and its chats are kept" disabled={p.disabled || open} onSelect={() => p.onForget(path)}>
                      <X />
                      Remove from the list
                    </DropdownMenuItem>
                    {open && <DropdownMenuLabel className="[overflow-wrap:anywhere]">The open workspace cannot be removed. Open another one first.</DropdownMenuLabel>}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                          <DropdownMenu open={menu === c.id} onOpenChange={(o) => setMenu(o ? c.id : null)}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className={`mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${menu === c.id ? 'opacity-100' : ''}`} aria-label={`Actions for "${c.title}"`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {pinOf(path, c.id)?.saved === false && (
                                <DropdownMenuItem onSelect={() => keepPin(path, c.id)}>
                                  <Pin className="fill-current" />
                                  Keep pinned
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => togglePin(path, c.id)}>
                                {isPinned(path, c.id) ? <PinOff /> : <Pin />}
                                {isPinned(path, c.id) ? 'Unpin' : 'Pin for this session'}
                              </DropdownMenuItem>
                              {p.onRename && (
                                <DropdownMenuItem aria-label={`Rename "${c.title}"`} onSelect={() => setEdit({ id: c.id, value: c.title })}>
                                  <Pencil />
                                  Rename
                                </DropdownMenuItem>
                              )}
                              {p.onExport && (
                                <DropdownMenuItem aria-label={`Export "${c.title}" as Markdown`} onSelect={() => p.onExport?.(c.id)}>
                                  <Download />
                                  Export as Markdown
                                </DropdownMenuItem>
                              )}
                              {p.onDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" aria-label={`Delete "${c.title}"`} disabled={p.disabled} onSelect={() => setConfirm(c.id)}>
                                    <Trash2 />
                                    Delete chat…
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
