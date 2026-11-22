import { useState } from 'react'
import { Download, FolderClock, History, MessageSquare, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import type { SessionInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ago } from '@/lib/ago'

const base = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p
const Head = ({ icon: Icon, children }: { icon: typeof History; children: string }) => (
  <h2 className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
    <Icon className="h-3 w-3 shrink-0" />
    {children}
  </h2>
)

/** Recent workspaces and the current workspace's saved chats. Everything is disabled while a turn runs. */
export function ChatsSidebar(p: { workspace: string | null; recent: string[]; chats: SessionInfo[]; current?: string; disabled: boolean; onWorkspace(path: string): void; onForget(path: string): void; onChat(id: string): void; onNew(): void; onDelete?(id: string): void; onExport?(id: string): void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  return (
    <>
      <div className="space-y-1">
        <Head icon={FolderClock}>Recent workspaces</Head>
        {p.recent.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        {p.recent.map((w) => (
          <div key={w} className="flex items-center">
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" disabled={p.disabled || w === p.workspace} title={w} onClick={() => p.onWorkspace(w)}>
              <span className="min-w-0 truncate">{base(w)}</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Remove ${base(w)} from the list`} title="Remove from the list (files and chats are kept)" disabled={p.disabled || w === p.workspace} onClick={() => p.onForget(w)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      {p.workspace && (
        <div className="space-y-1">
          <Head icon={History}>Chats</Head>
          <Button variant="outline" size="sm" className="w-full" disabled={p.disabled} onClick={p.onNew}>
            <Plus className="mr-1 h-4 w-4" />
            New chat
          </Button>
          {p.chats.length === 0 && <p className="text-xs text-muted-foreground">No saved chats yet.</p>}
          {p.chats.map((c) =>
            confirm === c.id ? (
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
            ) : (
              <div key={c.id} className={`group relative flex items-center rounded-md ${c.id === p.current ? 'bg-accent text-accent-foreground' : ''}`} aria-current={c.id === p.current ? 'true' : undefined}>
                {c.id === p.current && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />}
                <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start py-1 text-left hover:bg-transparent" disabled={p.disabled} title={c.title} onClick={() => p.onChat(c.id)}>
                  <MessageSquare className="mr-1 h-3 w-3 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${c.id === p.current ? 'font-medium' : ''}`}>{c.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{ago(c.updated)}</span>
                  </span>
                </Button>
                {(p.onExport || p.onDelete) && (
                  <Popover open={menu === c.id} onOpenChange={(o) => setMenu(o ? c.id : null)}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className={`mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${menu === c.id ? 'opacity-100' : ''}`} aria-label={`Actions for "${c.title}"`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-44 p-1">
                      {p.onExport && (
                        <Button variant="ghost" size="sm" className="w-full justify-start" aria-label={`Export "${c.title}" as Markdown`} onClick={() => { setMenu(null); p.onExport?.(c.id) }}>
                          <Download className="mr-2 h-3.5 w-3.5" />
                          Export as Markdown
                        </Button>
                      )}
                      {p.onDelete && (
                        <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:text-destructive" aria-label={`Delete "${c.title}"`} disabled={p.disabled} onClick={() => { setMenu(null); setConfirm(c.id) }}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete chat…
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )
          )}
        </div>
      )}
    </>
  )
}
