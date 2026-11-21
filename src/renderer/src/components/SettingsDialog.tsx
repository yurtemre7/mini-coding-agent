import { useState } from 'react'
import { Check, CircleAlert, CircleCheck, KeyRound } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS, PROVIDER_LABELS } from '@/lib/providers'
import { EFFORT_LEVELS, type Effort, type KeySource, type ProviderId, type SettingsInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SettingsActions {
  onUpdate(patch: { provider?: ProviderId; model?: string; effort?: Effort }): Promise<unknown> | void
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
        <p className="text-xs text-muted-foreground">{saved ? 'Paste a new key to replace the saved one.' : 'Saved to the macOS Keychain; never shown again.'}</p>
      </div>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, settings, models, disabled, ...actions }: { open: boolean; onOpenChange(open: boolean): void; settings: SettingsInfo; models?: ModelList; disabled?: boolean } & SettingsActions) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{disabled ? 'Provider, model and effort cannot change while a turn is running.' : 'Choose a provider, model and effort, and save its API key.'}</DialogDescription>
        </DialogHeader>
        <ProviderForm settings={settings} models={models} disabled={disabled} {...actions} />
      </DialogContent>
    </Dialog>
  )
}
