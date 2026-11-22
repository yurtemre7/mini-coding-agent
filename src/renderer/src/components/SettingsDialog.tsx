import { useState } from 'react'
import { Check, CircleAlert, CircleCheck, ExternalLink, Info, KeyRound, Monitor, Moon, Plug, SlidersHorizontal, Sun } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS, KEY_HELP, PROVIDER_LABELS } from '@/lib/providers'
import { EFFORT_LEVELS, type AppInfo, type Effort, type KeySource, type ProviderId, type SettingsInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { THEME_PREFS, type ThemePref } from '@/lib/theme'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SettingsActions {
  onUpdate(patch: { provider?: ProviderId; model?: string; effort?: Effort; notifications?: boolean }): Promise<unknown> | void
  onSaveKey(provider: ProviderId, key: string): Promise<unknown> | void
}

const SOURCE_LABELS: Record<KeySource, string> = { env: 'environment', dotenv: '.env', keychain: 'Keychain', file: '~/.mca/credentials.json' }

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

function GeneralPanel({ settings, theme, onUpdate }: { settings: SettingsInfo; theme?: { pref: ThemePref; onChange(p: ThemePref): void } } & Pick<SettingsActions, 'onUpdate'>) {
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
      <Separator />
      <Row title="Notifications" description="Desktop notification when MCA looks stuck, a prompt waits for you, or a turn runs long.">
        <Switch aria-label="Notifications" checked={settings.notifications} onCheckedChange={(notifications) => void onUpdate({ notifications })} />
      </Row>
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

export type SettingsTab = 'general' | 'provider' | 'mcp' | 'about'

export function SettingsDialog({ open, onOpenChange, settings, models, disabled, mcp = [], theme, info, tab = 'general', ...actions }: { open: boolean; onOpenChange(open: boolean): void; settings: SettingsInfo; models?: ModelList; disabled?: boolean; mcp?: string[]; theme?: { pref: ThemePref; onChange(p: ThemePref): void }; info?: AppInfo | null; tab?: SettingsTab } & SettingsActions) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{disabled ? 'Provider, model and effort cannot change while a turn is running.' : 'Appearance, provider and key, and about MCA.'}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={tab} orientation="vertical" className="min-h-72">
          <TabsList className="w-40 shrink-0" aria-label="Settings sections">
            <TabsTrigger value="general">
              <SlidersHorizontal aria-hidden />
              General
            </TabsTrigger>
            <TabsTrigger value="provider">
              <KeyRound aria-hidden />
              Provider
            </TabsTrigger>
            <TabsTrigger value="mcp">
              <Plug aria-hidden />
              MCP servers
            </TabsTrigger>
            <TabsTrigger value="about">
              <Info aria-hidden />
              About
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralPanel settings={settings} theme={theme} onUpdate={actions.onUpdate} />
          </TabsContent>
          <TabsContent value="provider">
            <ProviderForm settings={settings} models={models} disabled={disabled} {...actions} />
          </TabsContent>
          <TabsContent value="mcp">
            <section className="space-y-1" aria-label="MCP servers">
              {mcp.length === 0 && <p className="text-sm text-muted-foreground">None configured. Add them to .mcp.json in a trusted workspace.</p>}
              {mcp.map((line) => (
                <p key={line} className="text-sm [overflow-wrap:anywhere]">
                  {line}
                </p>
              ))}
            </section>
          </TabsContent>
          <TabsContent value="about">
            <AboutPanel info={info} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
