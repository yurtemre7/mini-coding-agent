import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Settings } from 'lucide-react'
import type { SettingsInfo } from '../../shared/types'
import { ChatTranscript } from '@/components/ChatTranscript'
import { PromptDialog } from '@/components/PermissionDialog'
import { PromptInput } from '@/components/PromptInput'
import { ProviderForm, SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAgentSession } from '@/hooks/useAgentSession'

const Drag = () => <div className="fixed inset-x-0 top-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

export default function App() {
  const api = window.mca
  const s = useAgentSession(api)
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  const loadSettings = useCallback(() => api?.invoke('settings:get').then(setSettings), [api])
  useEffect(() => void loadSettings(), [loadSettings])

  const actions = {
    onUpdate: async (patch: { provider?: 'anthropic' | 'openrouter'; model?: string }) => {
      setSetupError(null)
      try {
        setSettings(await api!.invoke('settings:update', patch))
        await s.refresh()
      } catch (e) {
        setSetupError((e as Error).message)
      }
    },
    onSaveKey: async (p: 'anthropic' | 'openrouter', key: string) => {
      setSetupError(null)
      try {
        setSettings(await api!.invoke('settings:setKey', p, key))
      } catch (e) {
        setSetupError((e as Error).message)
      }
    }
  }

  if (!api) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-sm text-muted-foreground">
        MCA must run inside the desktop app (npm run dev).
      </main>
    )
  }
  if (!settings || !s.state) return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</main>

  // first screen without a key is provider setup, not an error after the first prompt
  if (!settings.hasKey[settings.provider]) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <Drag />
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Set up a provider</CardTitle>
            <CardDescription>MCA uses your own API key. Choose a provider and paste its key to begin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProviderForm key={settings.provider} settings={settings} {...actions} />
            {setupError && <p className="text-sm text-destructive">{setupError}</p>}
          </CardContent>
        </Card>
      </main>
    )
  }

  const v = s.state
  const todos = v.todos
  return (
    <main className="flex h-screen bg-background text-foreground">
      <Drag />
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r p-3 pt-12">
        <Button variant="outline" disabled={v.busy} onClick={s.selectWorkspace} title={v.workspace ?? undefined}>
          <FolderOpen className="mr-2 h-4 w-4" />
          <span className="truncate">{v.workspace ? v.workspace.split('/').filter(Boolean).at(-1) : 'Open workspace'}</span>
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto text-sm">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">Todos</h2>
          {todos.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
          {todos.map((t, i) => (
            <p key={i} className={t.status === 'completed' ? 'text-muted-foreground line-through' : t.status === 'in_progress' ? 'font-medium' : ''}>
              {t.content}
            </p>
          ))}
        </div>
        {v.usage && (
          <p className="text-xs text-muted-foreground">
            Context {Math.round(v.usage.contextTokens / 1000)}k / {Math.round(v.usage.contextWindow / 1000)}k
          </p>
        )}
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="h-10 shrink-0" />
        {s.error && <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{s.error}</p>}
        <ChatTranscript items={v.items} />
        <PromptInput busy={v.busy} disabled={!v.workspace} mode={v.mode} onSend={s.send} onStop={s.abort} onMode={(m) => s.command(`/mode ${m}`)} onRewind={() => s.command('/rewind')} />
      </section>
      <PromptDialog request={v.pending?.request ?? null} onDecision={(d) => v.pending && s.answer(v.pending.id, d)} />
      <SettingsDialog key={settings.provider} open={open} onOpenChange={setOpen} settings={settings} disabled={v.busy} {...actions} />
    </main>
  )
}
