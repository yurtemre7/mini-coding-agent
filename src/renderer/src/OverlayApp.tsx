import { ExternalLink, X } from 'lucide-react'
import { ChatTranscript } from '@/components/ChatTranscript'
import { OverlayComposer } from '@/components/OverlayComposer'
import { PromptDialog } from '@/components/PermissionDialog'
import { QueuedMessages } from '@/components/QueuedMessages'
import { UsageMeter } from '@/components/UsageMeter'
import { Button } from '@/components/ui/button'
import { useAgentSession } from '@/hooks/useAgentSession'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { useKeys } from '@/lib/keybindings'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** The small floating chat: the same conversation as the main window, without the sidebars. Opaque, so it reads well over anything. */
export default function OverlayApp() {
  const api = window.mca
  const s = useAgentSession(api)
  const keys = useKeys()
  const v = s.state
  const queue = useMessageQueue({ busy: !!v?.busy, scope: v?.workspace ?? '', dispatch: (text, files) => s.send(text, files).then(() => s.refresh()) })
  const hide = () => void api?.invoke('overlay:hide')
  const stop = () => {
    queue.clear()
    void s.abort()
  }
  // a project and a key are chosen in the main window
  const showMain = () => void api?.invoke('app:showMain')

  return (
    <main className="flex h-screen flex-col overflow-hidden border bg-background text-foreground">
      <header style={drag} className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="truncate text-xs font-medium text-muted-foreground">{v?.workspace ? v.workspace.split(/[\\/]/).filter(Boolean).pop() : 'MCA'}</span>
        <div style={noDrag} className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Open the main window" title="Open the main window" onClick={showMain}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Hide the floating chat" title="Hide (press the shortcut again or Esc)" onClick={hide}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>
      {s.error && <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs [overflow-wrap:anywhere] text-destructive">{s.error}</p>}
      {!v ? (
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</p>
      ) : !v.workspace ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>No project is open yet.</p>
          <Button size="sm" onClick={showMain}>Open the main window</Button>
        </div>
      ) : (
        <ChatTranscript items={v.items} busy={v.busy} />
      )}
      {v?.usage && (
        <div className="shrink-0 border-t px-3 py-1">
          <UsageMeter usage={v.usage} />
        </div>
      )}
      <QueuedMessages items={queue.items} onRemove={queue.remove} />
      <OverlayComposer
        busy={!!v?.busy}
        disabled={!v?.workspace}
        onSend={(text) => (v?.busy ? queue.add(text) : /^\/\S/.test(text) ? void s.command(text) : void s.send(text))}
        onStop={stop}
        onEscape={hide}
      />
      <PromptDialog keys={keys.keys} request={v?.pending?.request ?? null} onDecision={(d) => v?.pending && s.answer(v.pending.id, d)} />
    </main>
  )
}
