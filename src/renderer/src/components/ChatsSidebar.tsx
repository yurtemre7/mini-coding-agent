import { FolderClock, History, MessageSquare, Plus } from 'lucide-react'
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
export function ChatsSidebar(p: { workspace: string | null; recent: string[]; chats: SessionInfo[]; disabled: boolean; onWorkspace(path: string): void; onChat(id: string): void; onNew(): void }) {
  return (
    <>
      <div className="space-y-1">
        <Head icon={FolderClock}>Recent workspaces</Head>
        {p.recent.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        {p.recent.map((w) => (
          <Button key={w} variant="ghost" size="sm" className="w-full justify-start" disabled={p.disabled || w === p.workspace} title={w} onClick={() => p.onWorkspace(w)}>
            <span className="min-w-0 truncate">{base(w)}</span>
          </Button>
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
          {p.chats.map((c) => (
            <Button key={c.id} variant="ghost" size="sm" className="h-auto w-full justify-start py-1 text-left" disabled={p.disabled} title={c.title} onClick={() => p.onChat(c.id)}>
              <MessageSquare className="mr-1 h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">{ago(c.updated)}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
    </>
  )
}
