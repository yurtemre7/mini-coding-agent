import { useState } from 'react'
import { Download, FolderClock, History, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import type { SessionInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { ago } from '@/lib/ago'

const base = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p
const Head = ({ icon: Icon, children }: { icon: typeof History; children: string }) => (
  <h2 className="flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
    <Icon className="h-3 w-3 shrink-0" />
    {children}
  </h2>
)

/** Recent workspaces and the current workspace's saved chats. Everything is disabled while a turn runs. */
export function ChatsSidebar(p: { workspace: string | null; recent: string[]; chats: SessionInfo[]; disabled: boolean; onWorkspace(path: string): void; onForget(path: string): void; onChat(id: string): void; onNew(): void; onDelete?(id: string): void; onExport?(id: string): void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
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
              <div key={c.id} className="group flex items-center">
                <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start py-1 text-left" disabled={p.disabled} title={c.title} onClick={() => p.onChat(c.id)}>
                  <MessageSquare className="mr-1 h-3 w-3 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{ago(c.updated)}</span>
                  </span>
                </Button>
                {p.onExport && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Export "${c.title}" as Markdown`} title="Export as Markdown" onClick={() => p.onExport?.(c.id)}>
                    <Download className="h-3 w-3" />
                  </Button>
                )}
                {p.onDelete && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Delete "${c.title}"`} title="Delete chat" disabled={p.disabled} onClick={() => setConfirm(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </>
  )
}
