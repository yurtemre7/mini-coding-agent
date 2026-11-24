import { useEffect, useState } from 'react'
import { Check, Keyboard, CircleAlert, CircleCheck, ExternalLink, Info, KeyRound, Monitor, Moon, Plug, ScrollText, Sparkles, SlidersHorizontal, Sun } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS, KEY_HELP, PROVIDER_LABELS } from '@/lib/providers'
import { CONTEXT_LIMITS, EFFORT_LEVELS, OVERLAY_SHORTCUTS, type AppInfo, type Effort, type KeySource, type ProviderId, type SettingsInfo, type SkillInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { comboOf, formatCombo, KEY_ACTIONS, type KeyAction, type KeyMap } from '@/lib/keybindings'
import { THEME_PREFS, type ThemePref } from '@/lib/theme'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SettingsActions {
  onUpdate(patch: { provider?: ProviderId; model?: string; effort?: Effort; notifications?: boolean; systemPrompt?: string; systemReplace?: boolean; contextLimit?: number; overlay?: boolean; overlayShortcut?: string }): Promise<unknown> | void
  onSaveKey(provider: ProviderId, key: string): Promise<unknown> | void
}

const SOURCE_LABELS: Record<KeySource, string> = { env: 'environment', dotenv: '.env', keychain: 'Keychain', file: '~/.mca/credentials.json' }

const tokenLabel = (n: number): string => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`)
const CONTEXT_NAMES: Record<number, string> = { 0: 'Automatic', 100_000: 'Small', 200_000: 'Standard', 500_000: 'Large', 1_000_000: 'Maximum' }

/** How much of a conversation the model keeps in view before MCA summarizes the older part. A cap can lower the model's own size, never raise it. */
function ContextSize({ settings, onUpdate }: { settings: SettingsInfo } & Pick<SettingsActions, 'onUpdate'>) {
  const max = settings.contextMax ?? 0
  const current = settings.contextLimit ?? 0
  const label = (n: number) => (n === 0 ? `Automatic${max ? ` (${tokenLabel(max)})` : ''}` : `${CONTEXT_NAMES[n]} (${tokenLabel(n)})`)
  return (
    <div className="space-y-2">
      <Label>Context size</Label>
      <Select value={String(current)} onValueChange={(v) => void onUpdate({ contextLimit: Number(v) })}>
        <SelectTrigger aria-label="Context size">
          <SelectValue>{label(current)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CONTEXT_LIMITS.map((n) => (
            <SelectItem key={n} value={String(n)} disabled={n > 0 && max > 0 && n > max}>
              {label(n)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        How much of the chat the model keeps in view. {max ? `This model supports up to ${tokenLabel(max)}. ` : ''}A smaller size is faster and cheaper; when it is 80 % full, older messages are summarized.
      </p>
    </div>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
/** 'CommandOrControl+Shift+Space' as people read it on this computer. */
const shortcutLabel = (accel: string): string => accel.split('+').map((p) => (p === 'CommandOrControl' ? (isMac ? 'Cmd' : 'Ctrl') : p)).join(' + ')

/** A small chat window that floats on top of other apps (also games in borderless full screen); a shortcut shows and hides it. */
function FloatingChat({ settings, onUpdate }: { settings: SettingsInfo } & Pick<SettingsActions, 'onUpdate'>) {
  const on = settings.overlay === true
  const key = settings.overlayShortcut ?? OVERLAY_SHORTCUTS[0]
  return (
    <div className="space-y-3">
      <Row title="Floating chat" description="A small chat window that stays on top of other apps, so you can ask MCA something without switching windows.">
        <Switch aria-label="Floating chat" checked={on} onCheckedChange={(overlay) => void onUpdate({ overlay })} />
      </Row>
      {on && (
        <div className="space-y-2">
          <Label>Show or hide with</Label>
          <Select value={key} onValueChange={(overlayShortcut) => void onUpdate({ overlayShortcut })}>
            <SelectTrigger aria-label="Floating chat shortcut">
              <SelectValue>{shortcutLabel(key)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OVERLAY_SHORTCUTS.map((a) => (
                <SelectItem key={a} value={a}>
                  {shortcutLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Press it again to hide the chat. It stays on top of games set to Borderless or Windowed fullscreen; it cannot show over games in exclusive fullscreen.</p>
        </div>
      )}
    </div>
  )
}

function KeyStatus({ settings, models }: { settings: SettingsInfo; models: ModelList }) {
  const p = settings.provider
  const src = settings.keySource[p]
  const row = (icon: React.ReactNode, text: string, tone = 'text-muted-foreground') => (
    <p className={`flex items-center gap-2 text-xs [overflow-wrap:anywhere] ${tone}`} role="status">
      {icon}
      {text}
    </p>
  )
  if (!settings.hasKey[p]) return row(<KeyRound className="h-4 w-4" aria-hidden />, 'No key yet')
  if (models.rejected) return row(<CircleAlert className="h-4 w-4" aria-hidden />, `Key rejected by ${PROVIDER_LABELS[p]}`, 'text-destructive')
  return row(<CircleCheck className="h-4 w-4" aria-hidden />, `Key found in ${src ? SOURCE_LABELS[src] : 'the credential store'}`)
}

/** Provider, model and key form. A stored key is never shown: the input stays empty and only says whether one exists. */
export function ProviderForm({ settings, models = { models: [] }, disabled, onUpdate, onSaveKey }: { settings: SettingsInfo; models?: ModelList; disabled?: boolean } & SettingsActions) {
  const [key, setKey] = useState('')
  const saved = settings.hasKey[settings.provider]
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Provider</Label>
        <Select
          value={settings.provider}
          disabled={disabled}
          onValueChange={(p) => {
            setKey('')
            void onUpdate({ provider: p as ProviderId })
          }}
        >
          <SelectTrigger aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
              <SelectItem key={p} value={p}>
                <span className="flex items-center gap-2">
                  {PROVIDER_LABELS[p]}
                  {settings.hasKey[p] && <Check className="h-4 w-4 text-muted-foreground" aria-label="Key found" />}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <ModelCombobox id="model" className="w-full" value={settings.model} list={models} disabled={disabled} onSelect={(model) => void onUpdate({ model })} />
      </div>
      <div className="space-y-2">
        <Label>Effort</Label>
        <Select value={settings.effort} disabled={disabled} onValueChange={(e) => void onUpdate({ effort: e as Effort })}>
          <SelectTrigger aria-label="Effort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EFFORT_LEVELS.map((e) => (
              <SelectItem key={e} value={e}>
                {EFFORT_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="api-key">API key</Label>
        {!saved && (
          <p className="text-xs text-muted-foreground" data-testid="key-help">
            {KEY_HELP[settings.provider].steps}{' '}
            <a className="underline" href={KEY_HELP[settings.provider].url} target="_blank" rel="noreferrer">
              Open the key page
            </a>
            . You pay the provider directly for what you use.
          </p>
        )}
        <div className="flex gap-2">
          <Input id="api-key" type="password" autoComplete="off" value={key} placeholder={saved ? 'Key saved' : 'Paste your API key'} onChange={(e) => setKey(e.target.value)} />
          <Button
            disabled={!key.trim()}
            onClick={async () => {
              await onSaveKey(settings.provider, key)
              setKey('')
            }}
          >
            Save key
          </Button>
        </div>
        <KeyStatus settings={settings} models={models} />
        <p className="text-xs text-muted-foreground">{saved ? 'Paste a new key to replace the saved one.' : 'Stored in the macOS Keychain when available, otherwise in a file only you can read. Never shown again, and sent only to the provider.'}</p>
      </div>
    </div>
  )
}

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon }
const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

function GeneralPanel({ settings, theme, focus, onUpdate }: { settings: SettingsInfo; theme?: { pref: ThemePref; onChange(p: ThemePref): void }; focus?: FocusStrength } & Pick<SettingsActions, 'onUpdate'>) {
  return (
    <div className="space-y-5">
      {theme && (
        <Row title="Appearance" description="Follow the system, or always use light or dark.">
          <div className="flex shrink-0 gap-1 rounded-lg border p-1" role="group" aria-label="Theme">
            {THEME_PREFS.map((p) => {
              const Icon = THEME_ICON[p]
              return (
                <Button key={p} size="sm" variant={theme.pref === p ? 'secondary' : 'ghost'} aria-pressed={theme.pref === p} onClick={() => theme.onChange(p)}>
                  <Icon className="mr-1 h-4 w-4" aria-hidden />
                  {THEME_LABEL[p]}
                </Button>
              )
            })}
          </div>
        </Row>
      )}
      {focus && (
        <>
          <Separator />
          <Row title="Message field highlight" description="How visible the message field is while it has the cursor. 100 % is the strongest.">
            <div className="flex shrink-0 items-center gap-2">
              <input type="range" min={0} max={100} step={10} value={focus.value} aria-label="Message field highlight" className="w-32 accent-primary" onChange={(e) => focus.onChange(Number(e.target.value))} />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{focus.value} %</span>
            </div>
          </Row>
        </>
      )}
      <Separator />
      <ContextSize settings={settings} onUpdate={onUpdate} />
      <Separator />
      <FloatingChat settings={settings} onUpdate={onUpdate} />
      <Separator />
      <Row title="Notifications" description="While MCA is in the background: a macOS notification when a task finishes, a permission prompt waits for you, or MCA looks stuck.">
        <Switch aria-label="Notifications" checked={settings.notifications} onCheckedChange={(notifications) => void onUpdate({ notifications })} />
      </Row>
    </div>
  )
}

/** Custom instructions: added after the built-in prompt, or used instead of it. Applies from the next message. */
function InstructionsPanel({ settings, onUpdate }: { settings: SettingsInfo } & Pick<SettingsActions, 'onUpdate'>) {
  const [draft, setDraft] = useState(settings.systemPrompt)
  const dirty = draft !== settings.systemPrompt
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="system-prompt">Custom instructions</Label>
        <Textarea id="system-prompt" className="max-h-60 min-h-32 font-mono text-xs" placeholder="For example: Answer in German. Prefer small commits. Never touch the migrations folder." value={draft} onChange={(e) => setDraft(e.target.value)} />
        <p className="text-xs text-muted-foreground">Sent to the model with every message, in all workspaces. Project rules belong in the project&apos;s CLAUDE.md. Applies from your next message.</p>
      </div>
      <Row title="Replace the built-in prompt" description="Use only your text. Without the built-in prompt MCA may behave differently.">
        <Switch aria-label="Replace the built-in prompt" checked={settings.systemReplace} disabled={!settings.systemPrompt.trim()} onCheckedChange={(systemReplace) => void onUpdate({ systemReplace })} />
      </Row>
      <div className="flex gap-2">
        <Button disabled={!dirty} onClick={() => void onUpdate({ systemPrompt: draft })}>
          Save instructions
        </Button>
        <Button variant="outline" disabled={!draft && !settings.systemPrompt} onClick={() => { setDraft(''); void onUpdate({ systemPrompt: '', systemReplace: false }) }}>
          Clear
        </Button>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show the built-in prompt</summary>
        <pre className="mt-2 max-h-32 overflow-auto rounded-md border bg-muted p-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{settings.defaultSystemPrompt}</pre>
      </details>
    </div>
  )
}

function AboutPanel({ info }: { info?: AppInfo | null }) {
  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>
  const link = (href: string, text: string) => (
    <a className="inline-flex items-center gap-1 text-sm underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
      {text}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  )
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{info.name}</h3>
        <p className="text-sm text-muted-foreground">A coding agent for your desktop. Bring your own API key; everything runs on your machine.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Version</dt>
        <dd>{info.version}</dd>
        <dt className="text-muted-foreground">License</dt>
        <dd>{info.license}</dd>
        <dt className="text-muted-foreground">Platform</dt>
        <dd>
          {info.platform} · Electron {info.electronVersion}
        </dd>
      </dl>
      <Separator />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {link(info.repoUrl, 'Source code on GitHub')}
        {link(`${info.repoUrl}/issues`, 'Report an issue')}
        {link(`${info.repoUrl}/releases`, 'Releases')}
      </div>
    </div>
  )
}

const SKILL_SOURCES: Record<SkillInfo['source'], string> = { claude: 'Claude Code', plugin: 'Claude plugin', antigravity: 'Antigravity', mca: 'MCA', project: 'This project' }

/** Every skill found on disk with a switch. A switched-off skill is neither offered to the model nor runnable as /name. */
export function SkillsPanel({ skills, onToggle }: { skills: SkillInfo[]; onToggle(name: string, enabled: boolean): void }) {
  return (
    <section className="space-y-3" aria-label="Skills">
      <p className="text-sm text-muted-foreground">
        Found in Claude Code (<code>~/.claude/skills</code> and plugins), Antigravity, <code>~/.mca/skills</code> and this project. Type <code>/name</code> in a chat to run one; the model also sees the enabled ones and can load them itself.
      </p>
      {skills.length === 0 && <p className="text-sm text-muted-foreground">No skills found.</p>}
      <ul className="space-y-2">
        {skills.map((s) => (
          <li key={s.name} className="flex items-start gap-3 rounded-md border p-2">
            <Switch checked={s.enabled} aria-label={`Enable ${s.name}`} onCheckedChange={(v) => onToggle(s.name, v)} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
                /{s.name}
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{SKILL_SOURCES[s.source]}</span>
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" title={s.file}>
                {s.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface FocusStrength {
  value: number
  onChange(v: number): void
}

/** Shortcut settings: the current map, a setter that returns an error message (or null), and a reset. */
export interface KeyEditor {
  keys: KeyMap
  set(action: KeyAction, combo: string): string | null
  reset(): void
}

const MENU_SHORTCUTS: [string, string][] = [
  ['Settings', 'Mod+,'], ['New chat', 'Mod+N'], ['Open workspace', 'Mod+O'], ['Focus the message field', 'Mod+L'], ['Stop the agent', 'Mod+.'],
  ['Toggle sidebar', 'Mod+B'], ['Toggle tools panel', 'Mod+J'], ['Show Changes / Git / Terminal', 'Mod+1 / 2 / 3']
]

/** Dialog shortcuts are editable (press the new keys); the menu shortcuts are listed for reference. */
export function ShortcutsPanel({ editor }: { editor: KeyEditor }) {
  const [capturing, setCapturing] = useState<KeyAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!capturing) return
    const h = (e: KeyboardEvent) => {
      const combo = comboOf(e)
      if (!combo) return // a bare modifier: keep waiting
      e.preventDefault()
      e.stopPropagation() // Escape must not close the settings dialog while capturing
      const err = editor.set(capturing, combo)
      setError(err)
      if (!err) setCapturing(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [capturing, editor])
  return (
    <section className="space-y-4" aria-label="Keyboard shortcuts">
      <div className="space-y-2">
        <p className="text-sm font-medium">Permission and plan dialogs</p>
        <p className="text-xs text-muted-foreground">Dangerous commands and trusting a workspace can never be allowed with a key. Shortcuts need ⌘/Ctrl or Alt (or are Esc or a function key), so typing feedback still works.</p>
        {KEY_ACTIONS.map(({ action, group, label }) => (
          <div key={action} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm">
              {label} <span className="text-xs text-muted-foreground">({group})</span>
            </span>
            <Button size="sm" variant={capturing === action ? 'secondary' : 'outline'} className="min-w-28 shrink-0 font-mono" aria-label={`Change shortcut for ${label} (${group})`} onClick={() => (setError(null), setCapturing(capturing === action ? null : action))}>
              {capturing === action ? 'Press keys…' : formatCombo(editor.keys[action])}
            </Button>
          </div>
        ))}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button size="sm" variant="ghost" onClick={() => (setCapturing(null), setError(null), editor.reset())}>
          Reset to defaults
        </Button>
      </div>
      <Separator />
      <div className="space-y-1">
        <p className="text-sm font-medium">Menu shortcuts</p>
        {MENU_SHORTCUTS.map(([label, combo]) => (
          <div key={label} className="flex justify-between text-sm">
            <span>{label}</span>
            <span className="font-mono text-xs text-muted-foreground">{combo.split(' / ').map((c) => formatCombo(c)).join(' / ')}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export type SettingsTab = 'general' | 'provider' | 'instructions' | 'skills' | 'mcp' | 'shortcuts' | 'about'

export function SettingsDialog({ open, onOpenChange, settings, models, disabled, mcp = [], skills = [], onSkill = () => {}, theme, focus, info, keyEditor, tab = 'general', ...actions }: { open: boolean; onOpenChange(open: boolean): void; settings: SettingsInfo; models?: ModelList; disabled?: boolean; mcp?: string[]; skills?: SkillInfo[]; onSkill?(name: string, enabled: boolean): void; theme?: { pref: ThemePref; onChange(p: ThemePref): void }; info?: AppInfo | null; focus?: FocusStrength; keyEditor?: KeyEditor; tab?: SettingsTab } & SettingsActions) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(44rem,85vh)] flex-col gap-4 sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{disabled ? 'Provider, model and effort cannot change while a turn is running.' : 'Appearance, provider and key, instructions, and about MCA.'}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={tab} orientation="vertical" className="min-h-0 flex-1">
          <TabsList className="h-fit max-h-full w-40 shrink-0 overflow-y-auto" aria-label="Settings sections">
            <TabsTrigger value="general">
              <SlidersHorizontal aria-hidden />
              General
            </TabsTrigger>
            <TabsTrigger value="provider">
              <KeyRound aria-hidden />
              Provider
            </TabsTrigger>
            <TabsTrigger value="instructions">
              <ScrollText aria-hidden />
              Instructions
            </TabsTrigger>
            <TabsTrigger value="skills">
              <Sparkles aria-hidden />
              Skills
            </TabsTrigger>
            <TabsTrigger value="mcp">
              <Plug aria-hidden />
              MCP servers
            </TabsTrigger>
            {keyEditor && (
              <TabsTrigger value="shortcuts">
                <Keyboard aria-hidden />
                Shortcuts
              </TabsTrigger>
            )}
            <TabsTrigger value="about">
              <Info aria-hidden />
              About
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <GeneralPanel settings={settings} theme={theme} focus={focus} onUpdate={actions.onUpdate} />
          </TabsContent>
          <TabsContent value="provider" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <ProviderForm settings={settings} models={models} disabled={disabled} {...actions} />
          </TabsContent>
          <TabsContent value="instructions" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <InstructionsPanel settings={settings} onUpdate={actions.onUpdate} />
          </TabsContent>
          <TabsContent value="skills" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <SkillsPanel skills={skills} onToggle={onSkill} />
          </TabsContent>
          <TabsContent value="mcp" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <section className="space-y-1" aria-label="MCP servers">
              {mcp.length === 0 && <p className="text-sm text-muted-foreground">None configured. Add them to .mcp.json in a trusted workspace.</p>}
              {mcp.map((line) => (
                <p key={line} className="text-sm [overflow-wrap:anywhere]">
                  {line}
                </p>
              ))}
            </section>
          </TabsContent>
          {keyEditor && (
            <TabsContent value="shortcuts" className="min-h-0 min-w-0 overflow-y-auto pr-1">
              <ShortcutsPanel editor={keyEditor} />
            </TabsContent>
          )}
          <TabsContent value="about" className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <AboutPanel info={info} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
