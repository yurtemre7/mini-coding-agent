import { useCallback, useEffect, useState } from 'react'
import { FileDiff, FolderOpen, Settings } from 'lucide-react'
import type { AppInfo, CommandInfo, Effort, ProviderId, SessionInfo, SettingsInfo } from '../../shared/types'
import type { ModelList } from '@/components/ModelCombobox'
import { UsageMeter } from './components/UsageMeter'
import { DiffPanel } from './components/DiffPanel'
import { TodoSidebar } from './components/TodoSidebar'
import { ChatsSidebar } from '@/components/ChatsSidebar'
import { ChatTranscript } from '@/components/ChatTranscript'
import { PromptDialog } from '@/components/PermissionDialog'
import { PromptInput } from '@/components/PromptInput'
import { ProviderForm, SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAgentSession } from '@/hooks/useAgentSession'
import { useTheme } from '@/lib/theme'

const Drag = () => <div className="fixed inset-x-0 top-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

export default function App() {
  const api = window.mca
  const s = useAgentSession(api)
  const theme = useTheme()
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api?.invoke('app:getInfo').then(setInfo, () => {}), [api])
  const [recent, setRecent] = useState<string[]>([])
  const [chats, setChats] = useState<SessionInfo[]>([])
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [setupError, setSetupError] = useState<string | null>(null)

  const [keyN, setKeyN] = useState(0) // bumped on every saved key so a replaced key is re-checked
  const [fetched, setFetched] = useState<{ key: string; list: ModelList } | null>(null)
  const loadSettings = useCallback(() => api?.invoke('settings:get').then(setSettings), [api])
  useEffect(() => void loadSettings(), [loadSettings])

  // saved chats and recent workspaces: refetched when the workspace changes or a turn ends (a turn saves its messages)
  const workspace = s.state?.workspace ?? null
  const busy = s.state?.busy
  useEffect(() => {
    if (!api || busy) return
    api.invoke('workspace:recent').then(setRecent, () => {})
    api.invoke('session:list').then(setChats, () => {})
    api.invoke('commands:list').then(setCommands, () => {})
  }, [api, workspace, busy])

  // the provider's model list (fetched in main with the stored key); refetched when the provider or its key changes
  const provider = settings?.provider
  const source = provider && settings?.keySource[provider]
  const modelsKey = provider && settings?.hasKey[provider] ? `${provider}:${source}:${keyN}` : null
  useEffect(() => {
    if (!api || !provider || !modelsKey) return
    let live = true
    api.invoke('settings:models', provider).then(
      (list) => live && setFetched({ key: modelsKey, list }),
      () => live && setFetched({ key: modelsKey, list: { models: [] } })
    )
    return () => {
      live = false
    }
  }, [api, provider, modelsKey])
  // while a newer fetch is pending, the previous list stays visible and is marked as loading
  const models: ModelList = !modelsKey ? { models: [] } : fetched?.key === modelsKey ? fetched.list : { models: fetched?.list.models ?? [], loading: true }

  const actions = {
    onUpdate: async (patch: { provider?: ProviderId; model?: string; effort?: Effort; notifications?: boolean }) => {
      setSetupError(null)
      try {
        setSettings(await api!.invoke('settings:update', patch))
        await s.refresh()
      } catch (e) {
        setSetupError((e as Error).message)
      }
    },
    onSaveKey: async (p: ProviderId, key: string) => {
      setSetupError(null)
      try {
        setSettings(await api!.invoke('settings:setKey', p, key))
        setKeyN((n) => n + 1)
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
            <ProviderForm key={settings.provider} settings={settings} models={models} {...actions} />
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
          <span className="min-w-0 truncate">{v.workspace ? v.workspace.split('/').filter(Boolean).at(-1) : 'Open workspace'}</span>
        </Button>
        <div className="flex-1 space-y-4 overflow-y-auto text-sm">
          <ChatsSidebar workspace={v.workspace} recent={recent} chats={chats} disabled={v.busy} onWorkspace={s.openWorkspace} onForget={(w) => void s.forgetWorkspace(w).then(() => api.invoke('workspace:recent').then(setRecent))} onChat={s.openChat} onNew={s.newChat} />
          <TodoSidebar todos={todos} />
        </div>
        {v.usage && <UsageMeter usage={v.usage} />}
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-end px-3">
          <Button size="sm" variant={diffOpen ? 'secondary' : 'ghost'} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} aria-pressed={diffOpen} onClick={() => setDiffOpen((d) => !d)}>
            <FileDiff className="mr-1 h-4 w-4" />
            Changes ({v.changes.total.length})
          </Button>
        </div>
        {s.error && <p className="border-b bg-destructive/10 px-4 py-2 text-sm [overflow-wrap:anywhere] text-destructive">{s.error}</p>}
        <ChatTranscript items={v.items} />
        <PromptInput busy={v.busy} disabled={!v.workspace} mode={v.mode} model={v.model} models={models} onModel={(model) => actions.onUpdate({ model })} effort={settings.effort} onEffort={(effort) => actions.onUpdate({ effort })} commands={commands} onSend={(text, files) => (!files?.length && /^\/\S/.test(text) ? s.command(text).then(loadSettings) : s.send(text, files))} onStop={s.abort} onMode={(m) => s.command(`/mode ${m}`)} onRewind={() => s.command('/rewind')} />
      </section>
      {diffOpen && (
        <aside className="flex w-96 shrink-0 flex-col border-l p-3 pt-12">
          <DiffPanel changes={v.changes} busy={v.busy} loadDiff={s.changeDiff} onRevert={s.changeRevert} />
        </aside>
      )}
      <PromptDialog request={v.pending?.request ?? null} onDecision={(d) => v.pending && s.answer(v.pending.id, d)} />
      <SettingsDialog key={settings.provider} open={open} onOpenChange={setOpen} settings={settings} models={models} disabled={v.busy} mcp={v.mcp} theme={{ pref: theme.pref, onChange: theme.setPref }} info={info} {...actions} />
    </main>
  )
}
