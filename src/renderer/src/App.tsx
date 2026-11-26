import { useCallback, useEffect, useRef, useState } from 'react'
import { Columns2, Columns3, PanelLeft, PanelRight, PictureInPicture2, RectangleHorizontal, Settings, Smartphone, Square, X } from 'lucide-react'
import { isMenuAction, type AppInfo, type CommandInfo, type MenuAction, type ProviderId, type SettingsInfo, type SkillInfo, type WorkspaceChats } from '../../shared/types'
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
import { QueuedMessages } from '@/components/QueuedMessages'
import { ProviderForm, SettingsDialog, type SettingsActions } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAgentSession } from '@/hooks/useAgentSession'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { useTheme } from '@/lib/theme'
import { useKeys } from '@/lib/keybindings'
import { useFocusStrength } from '@/lib/focusStrength'
import { usePip } from '@/lib/pip'
import { QuickFolders } from '@/components/QuickFolders'
import { CipResizeGrips } from '@/components/CipResizeGrips'

const Drag = () => <div className="fixed inset-x-0 top-0 z-0 h-10" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

export default function App() {
  const api = window.mca
  const s = useAgentSession(api)
  const theme = useTheme()
  const lay = useLayout()
  const term = useTerminal(api)
  const keys = useKeys()
  const focusStrength = useFocusStrength()
  const pip = usePip(api)
  const compact = pip.mode === 'phone' // phone CiP: one column, sidebar as an overlay; normal CiP looks like the main window
  const [pipSidebar, setPipSidebar] = useState(false) // CiP: the sidebar is an overlay, opened by a double-click
  const [newest, setNewest] = useState<string[]>([])
  const refreshNewest = useCallback(() => api?.invoke('workspace:newest').then((l) => setNewest(Array.isArray(l) ? l : []), () => {}), [api])
  // CiP: the overlay closes when the window loses focus
  useEffect(() => {
    if (!compact) return
    const close = () => setPipSidebar(false)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [compact])
  const [focusN, setFocusN] = useState(0) // bumped to move the cursor into the message field
  const [settings, setSettings] = useState<SettingsInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api?.invoke('app:getInfo').then(setInfo, () => {}), [api])
  const [workspaces, setWorkspaces] = useState<WorkspaceChats[]>([])
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [setupError, setSetupError] = useState<string | null>(null)

  const [keyN, setKeyN] = useState(0) // bumped on every saved key so a replaced key is re-checked
  const [fetched, setFetched] = useState<{ key: string; list: ModelList } | null>(null)
  const loadSettings = useCallback(() => api?.invoke('settings:get').then(setSettings), [api])
  const listFiles = useCallback(() => api!.invoke('workspace:files'), [api])
  useEffect(() => void loadSettings(), [loadSettings])

  // saved chats and recent workspaces: refetched when the workspace changes or a turn ends (a turn saves its messages)
  const workspace = s.state?.workspace ?? null
  const busy = s.state?.busy
  // messages typed during a turn; `refresh` makes the next `busy` visible before the queue looks again
  const queue = useMessageQueue({ busy: !!busy, scope: workspace ?? '', dispatch: (text, files) => s.send(text, files).then(() => s.refresh()) })
  // Stop halts the whole plan: the queued messages are dropped too
  const stop = () => {
    queue.clear()
    void s.abort()
  }
  useEffect(() => {
    if (!api || busy) return
    api.invoke('workspace:overview').then(setWorkspaces, () => {})
    api.invoke('commands:list').then(setCommands, () => {})
    void refreshNewest()
  }, [api, workspace, busy, refreshNewest])

  const refreshWorkspaces = () => api?.invoke('workspace:overview').then(setWorkspaces, () => {})
  // a chat or a new chat in another workspace opens that workspace first; if that fails (trust declined, busy) nothing else happens
  const switchTo = async (path: string) => {
    if (path === workspace) return true
    await s.openWorkspace(path)
    return (await api!.invoke('session:getState')).workspace === path
  }
  const openChatIn = async (path: string, id: string) => {
    if (await switchTo(path)) await s.openChat(id)
  }
  const newChatIn = async (path: string) => {
    if (await switchTo(path)) await s.newChat()
  }

  const toggleSidebar = () => (compact ? setPipSidebar((v) => !v) : lay.toggleSidebar())
  const openSettings = () => (void s.skills().then(setSkills), setOpen(true))
  // native menu items and their accelerators; the latest closure is kept in a ref so the subscription is made once
  const onMenu = useRef<(a: MenuAction) => void>(() => {})
  useEffect(() => {
    onMenu.current = (a) => {
      if (a === 'settings') openSettings()
      else if (a === 'toggleSidebar') toggleSidebar()
      else if (a === 'togglePip') pip.toggle()
      else if (a === 'togglePanel') lay.togglePanel()
      else if (a === 'tabChanges') lay.showTab('changes')
      else if (a === 'tabGit') lay.showTab('git')
      else if (a === 'tabTerminal') lay.showTab('terminal')
      else if (a === 'focusPrompt') setFocusN((n) => n + 1)
      else if (a === 'openWorkspace') void s.selectWorkspace()
      else if (a === 'newChat' && workspace) void newChatIn(workspace).then(() => setFocusN((n) => n + 1))
      else if (a === 'stop' && busy) stop()
    }
  })
  useEffect(() => api?.on('menu:action', (a) => isMenuAction(a) && onMenu.current(a)), [api])
  // right-click anywhere without a menu of its own (a handler that calls preventDefault wins) opens the quick-actions menu
  useEffect(() => {
    if (!api) return
    const open = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      const t = e.target instanceof Element ? e.target : null
      const editable = !!t?.closest('input:not([type=range]):not([type=checkbox]),textarea,[contenteditable=""],[contenteditable=true]')
      void api.invoke('window:contextMenu', { selection: !!window.getSelection()?.toString(), editable }).catch(() => {})
    }
    window.addEventListener('contextmenu', open)
    return () => window.removeEventListener('contextmenu', open)
  }, [api])

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
  const sidebar = compact ? pipSidebar : lay.layout.sidebar
  // CiP: a double-click anywhere but a control focuses the window and opens the sidebar
  const onDoubleClick = (e: React.MouseEvent) => {
    if (compact && !pipSidebar && !(e.target as HTMLElement).closest('textarea,input,button,a,[role=combobox]')) setPipSidebar(true)
  }
  return (
    <main className="relative flex h-screen bg-background text-foreground">
      <Drag />
      {pip.on && <CipResizeGrips api={api} />}
      {compact && pipSidebar && <div aria-hidden className="absolute inset-0 z-20 bg-black/30" onClick={() => setPipSidebar(false)} />}
      {sidebar && (
      <aside aria-label="Sidebar" className={`flex w-60 shrink-0 flex-col gap-3 border-r bg-sidebar p-3 pt-12 ${compact ? 'absolute inset-y-0 left-0 z-30 max-w-[85vw] shadow-lg' : ''}`}>
        <div className="flex-1 space-y-4 overflow-y-auto text-sm">
          <ChatsSidebar
            workspaces={workspaces}
            workspace={v.workspace}
            current={v.chat}
            disabled={v.busy}
            onNewWorkspace={s.selectWorkspace}
            newest={newest}
            onNewestHover={() => void refreshNewest()}
            onWorkspace={(path) => void s.openWorkspace(path)}
            onReorder={(order) => {
              setWorkspaces((ws) => order.flatMap((p) => ws.filter((w) => w.path === p))) // show the new order at once
              void s.reorderWorkspaces(order).then(refreshWorkspaces)
            }}
            onForget={(w) => void s.forgetWorkspace(w).then(refreshWorkspaces)}
            onReveal={() => void s.reveal()}
            onChat={(path, id) => void openChatIn(path, id)}
            onActivate={(path, id) => void openChatIn(path, id).then(() => setFocusN((n) => n + 1))}
            onNew={(path) => void newChatIn(path)}
            onDelete={(id) => void s.deleteChat(id).then(refreshWorkspaces)}
            onRename={(id, title) => void s.renameChat(id, title).then(refreshWorkspaces)}
            onExport={(id) => void s.exportChat(id)}
          />
          <TodoSidebar todos={todos} />
        </div>
        {v.usage && <UsageMeter usage={v.usage} />}
        <Button variant="ghost" onClick={openSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </aside>
      )}
      <section className="flex min-w-0 flex-1 flex-col" onDoubleClick={onDoubleClick}>
        <div className={`relative z-10 flex h-10 shrink-0 items-center justify-between gap-2 px-3 ${sidebar || pip.on ? '' : 'pl-20'}`}>
          <div className="flex min-w-0 items-center gap-1">
            <Button style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={sidebar ? 'Hide the sidebar' : 'Show the sidebar'} title="Sidebar (Cmd/Ctrl+B)" aria-pressed={sidebar} onClick={toggleSidebar}>
              <PanelLeft className="h-4 w-4" />
            </Button>
            {pip.on && <QuickFolders workspace={v.workspace} recent={workspaces.map((w) => w.path)} newest={newest} disabled={v.busy} onPick={(p) => void s.openWorkspace(p).then(refreshWorkspaces)} onOpen={() => void (refreshWorkspaces(), refreshNewest())} />}
          </div>
          <div className="flex items-center gap-1">
            {pip.on && (
              <Button style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} size="icon" variant="ghost" className="h-8 w-8" aria-label={pip.mode === 'phone' ? 'Switch CiP to normal size' : 'Switch CiP to phone size'} title={pip.mode === 'phone' ? 'Normal size' : 'Phone size'} onClick={() => pip.setSize(pip.mode === 'phone' ? 'normal' : 'phone')}>
                {pip.mode === 'phone' ? <RectangleHorizontal className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
              </Button>
            )}
            {pip.on ? (
              <Button style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} size="icon" variant="ghost" className="h-8 w-8" aria-label="Leave CiP" title="Back to the full window (Cmd/Ctrl+Shift+P)" onClick={pip.toggle}>
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} size="icon" variant="ghost" className="h-8 w-8" aria-label="CiP" title="CiP: chat in picture (Cmd/Ctrl+Shift+P)" onClick={pip.toggle}>
                <PictureInPicture2 className="h-4 w-4" />
              </Button>
            )}
            {!compact && (
            <>
            <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} role="group" aria-label="Layout" className="flex rounded-md border p-0.5">
              {([[1, Square, '1 column: chat only'], [2, Columns2, '2 columns: chat and tools'], [3, Columns3, '3 columns: sidebar, chat and tools']] as const).map(([n, Icon, label]) => (
                <Button key={n} size="icon" variant={columns(lay.layout) === n ? 'secondary' : 'ghost'} className="h-7 w-7" aria-label={label} title={label} aria-pressed={columns(lay.layout) === n} onClick={() => lay.setColumns(n)}>
                  <Icon className="h-4 w-4" />
                </Button>
              ))}
            </div>
            <Button style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} size="icon" variant="ghost" className="h-8 w-8" aria-label={lay.layout.panel ? 'Hide the tools panel' : 'Show the tools panel'} title="Tools (Cmd/Ctrl+J)" aria-pressed={lay.layout.panel} onClick={lay.togglePanel}>
              <PanelRight className="h-4 w-4" />
            </Button>
            </>
            )}
          </div>
        </div>
        {s.error && <p className="border-b bg-destructive/10 px-4 py-2 text-sm [overflow-wrap:anywhere] text-destructive">{s.error}</p>}
        {v.items.length === 0 ? <EmptyState workspace={v.workspace} onOpenWorkspace={s.selectWorkspace} /> : <ChatTranscript items={v.items} busy={v.busy} />}
        <QueuedMessages items={queue.items} onRemove={queue.remove} />
        <PromptInput key={v.workspace ?? ''} compact={compact} focusSignal={focusN} focusStrength={focusStrength.value} busy={v.busy} disabled={!v.workspace} mode={v.mode} model={v.model} models={models} onModel={(model) => actions.onUpdate({ model })} effort={settings.effort} onEffort={(effort) => actions.onUpdate({ effort })} commands={commands} listFiles={listFiles} onSend={(text, files) => (v.busy ? queue.add(text, files) : !files?.length && /^\/\S/.test(text) ? s.command(text).then(loadSettings) : s.send(text, files))} onStop={stop} onMode={(m) => s.command(`/mode ${m}`)} onRewind={() => s.command('/rewind')} />
      </section>
      {!compact && lay.layout.panel && (
        <aside aria-label="Tools" className="flex w-[26rem] max-w-[45vw] shrink-0 flex-col border-l bg-sidebar p-3 pt-12">
          <SidePanel tab={lay.layout.tab} onTab={lay.setTab} badge={{ changes: v.changes.total.length }}>
            {lay.layout.tab === 'changes' && <DiffPanel changes={v.changes} busy={v.busy} loadDiff={s.changeDiff} onRevert={s.changeRevert} />}
            {lay.layout.tab === 'git' && api && <GitPanel api={api} workspace={v.workspace} busy={v.busy} refreshKey={`${v.busy}:${v.changes.total.length}`} />}
            {lay.layout.tab === 'terminal' && <TerminalPanel log={term.log} running={term.running} hasWorkspace={!!v.workspace} onRun={(c) => void term.run(c)} onStop={term.kill} onClear={term.clear} />}
          </SidePanel>
        </aside>
      )}
      <PromptDialog keys={keys.keys} request={v.pending?.request ?? null} onDecision={(d) => v.pending && s.answer(v.pending.id, d)} />
      <SettingsDialog key={settings.provider} open={open} onOpenChange={setOpen} settings={settings} models={models} disabled={v.busy} mcp={v.mcp} skills={skills} onSkill={(n, e) => void s.setSkill(n, e).then((l) => (setSkills(l), api?.invoke('commands:list').then(setCommands, () => {})))} theme={{ pref: theme.pref, onChange: theme.setPref }} info={info} keyEditor={keys} focus={{ value: focusStrength.value, onChange: focusStrength.set }} pipOpacity={{ value: pip.opacity, onChange: pip.setOpacity }} cipSize={{ value: pip.size, onChange: pip.setSize }} folders={{ onAdd: () => void api.invoke('settings:addFolderRoot').then(setSettings, () => {}), onRemove: (f) => void api.invoke('settings:removeFolderRoot', f).then(setSettings, () => {}) }} {...actions} />
    </main>
  )
}
