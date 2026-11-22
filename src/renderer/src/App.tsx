import { useCallback, useEffect, useState } from 'react'
import { Columns2, Columns3, ExternalLink, FolderOpen, PanelLeft, PanelRight, Settings, Square } from 'lucide-react'
import type { AppInfo, CommandInfo, ProviderId, SessionInfo, SettingsInfo } from '../../shared/types'
import type { ModelList } from '@/components/ModelCombobox'
import { EmptyState } from './components/EmptyState'
import { UsageMeter } from './components/UsageMeter'
import { DiffPanel } from './components/DiffPanel'
import { GitPanel } from './components/GitPanel'
import { SidePanel } from './components/SidePanel'
import { TerminalPanel } from './components/TerminalPanel'
import { useTerminal } from './hooks/useTerminal'
import { columns, useLayout } from './lib/layout'
import { TodoSidebar } from './components/TodoSidebar'
import { ChatsSidebar } from '@/components/ChatsSidebar'
import { ChatTranscript } from '@/components/ChatTranscript'
import { PromptDialog } from '@/components/PermissionDialog'
import { PromptInput } from '@/components/PromptInput'
import { ProviderForm, SettingsDialog, type SettingsActions } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAgentSession } from '@/hooks/useAgentSession'
import { useTheme } from '@/lib/theme'

const Drag = () => <div className="fixed inset-x-0 top-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

export default function App() {
  const api = window.mca
  const s = useAgentSession(api)
  const theme = useTheme()
  const lay = useLayout()
  const term = useTerminal(api)
  const { toggleSidebar, togglePanel } = lay
  useEffect(() => {
    // Cmd/Ctrl+B folds the sidebar, Cmd/Ctrl+J the tools column
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (e.key === 'b' || e.key === 'j') {
        e.preventDefault()
        if (e.key === 'b') toggleSidebar()
        else togglePanel()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [toggleSidebar, togglePanel])
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [open, setOpen] = useState(false)
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

  const refreshChats = () => api?.invoke('session:list').then(setChats, () => {})

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
    onUpdate: async (patch: Parameters<SettingsActions['onUpdate']>[0]) => {
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
            <p className="text-sm font-medium text-muted-foreground">Welcome to MCA</p>
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
      {lay.layout.sidebar && (
      <aside aria-label="Sidebar" className="flex w-60 shrink-0 flex-col gap-3 border-r bg-sidebar p-3 pt-12">
        <div className="flex gap-1">
          <Button variant="outline" className="min-w-0 flex-1" disabled={v.busy} onClick={s.selectWorkspace} title={v.workspace ?? undefined}>
            <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{v.workspace ? v.workspace.split('/').filter(Boolean).at(-1) : 'Open workspace'}</span>
          </Button>
          {v.workspace && (
            <Button variant="outline" size="icon" className="shrink-0" aria-label="Show the workspace in Finder" title="Show in Finder" onClick={() => void s.reveal()}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto text-sm">
          <ChatsSidebar workspace={v.workspace} recent={recent} chats={chats} disabled={v.busy} onWorkspace={s.openWorkspace} onForget={(w) => void s.forgetWorkspace(w).then(() => api.invoke('workspace:recent').then(setRecent))} onChat={s.openChat} onNew={s.newChat} onDelete={(id) => void s.deleteChat(id).then(refreshChats)} onExport={(id) => void s.exportChat(id)} />
          <TodoSidebar todos={todos} />
        </div>
        {v.usage && <UsageMeter usage={v.usage} />}
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </aside>
      )}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className={`flex h-10 shrink-0 items-center justify-between gap-2 px-3 ${lay.layout.sidebar ? '' : 'pl-20'}`} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={lay.layout.sidebar ? 'Hide the sidebar' : 'Show the sidebar'} title="Sidebar (Cmd/Ctrl+B)" aria-pressed={lay.layout.sidebar} onClick={lay.toggleSidebar}>
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1">
            <div role="group" aria-label="Layout" className="flex rounded-md border p-0.5">
              {([[1, Square, '1 column: chat only'], [2, Columns2, '2 columns: chat and tools'], [3, Columns3, '3 columns: sidebar, chat and tools']] as const).map(([n, Icon, label]) => (
                <Button key={n} size="icon" variant={columns(lay.layout) === n ? 'secondary' : 'ghost'} className="h-7 w-7" aria-label={label} title={label} aria-pressed={columns(lay.layout) === n} onClick={() => lay.setColumns(n)}>
                  <Icon className="h-4 w-4" />
                </Button>
              ))}
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={lay.layout.panel ? 'Hide the tools panel' : 'Show the tools panel'} title="Tools (Cmd/Ctrl+J)" aria-pressed={lay.layout.panel} onClick={lay.togglePanel}>
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {s.error && <p className="border-b bg-destructive/10 px-4 py-2 text-sm [overflow-wrap:anywhere] text-destructive">{s.error}</p>}
        {v.items.length === 0 ? <EmptyState workspace={v.workspace} onOpenWorkspace={s.selectWorkspace} /> : <ChatTranscript items={v.items} />}
        <PromptInput key={v.workspace ?? ''} busy={v.busy} disabled={!v.workspace} mode={v.mode} model={v.model} models={models} onModel={(model) => actions.onUpdate({ model })} effort={settings.effort} onEffort={(effort) => actions.onUpdate({ effort })} commands={commands} listFiles={() => api.invoke('workspace:files')} onSend={(text, files) => (!files?.length && /^\/\S/.test(text) ? s.command(text).then(loadSettings) : s.send(text, files))} onStop={s.abort} onMode={(m) => s.command(`/mode ${m}`)} onRewind={() => s.command('/rewind')} />
      </section>
      {lay.layout.panel && (
        <aside aria-label="Tools" className="flex w-[26rem] max-w-[45vw] shrink-0 flex-col border-l bg-sidebar p-3 pt-12">
          <SidePanel tab={lay.layout.tab} onTab={lay.setTab} badge={{ changes: v.changes.total.length }}>
            {lay.layout.tab === 'changes' && <DiffPanel changes={v.changes} busy={v.busy} loadDiff={s.changeDiff} onRevert={s.changeRevert} />}
            {lay.layout.tab === 'git' && api && <GitPanel api={api} workspace={v.workspace} busy={v.busy} refreshKey={`${v.busy}:${v.changes.total.length}`} />}
            {lay.layout.tab === 'terminal' && <TerminalPanel log={term.log} running={term.running} hasWorkspace={!!v.workspace} onRun={(c) => void term.run(c)} onStop={term.kill} onClear={term.clear} />}
          </SidePanel>
        </aside>
      )}
      <PromptDialog request={v.pending?.request ?? null} onDecision={(d) => v.pending && s.answer(v.pending.id, d)} />
      <SettingsDialog key={settings.provider} open={open} onOpenChange={setOpen} settings={settings} models={models} disabled={v.busy} mcp={v.mcp} theme={{ pref: theme.pref, onChange: theme.setPref }} info={info} {...actions} />
    </main>
  )
}
