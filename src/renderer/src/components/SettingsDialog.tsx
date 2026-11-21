import { useState } from 'react'
import { PROVIDER_LABELS } from '@/lib/providers'
import type { ProviderId, SettingsInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SettingsActions {
  onUpdate(patch: { provider?: ProviderId; model?: string }): Promise<unknown> | void
  onSaveKey(provider: ProviderId, key: string): Promise<unknown> | void
}

/** Provider, model and key form. A stored key is never shown: the input stays empty and only says whether one exists. */
export function ProviderForm({ settings, disabled, onUpdate, onSaveKey }: { settings: SettingsInfo; disabled?: boolean } & SettingsActions) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(settings.model)
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
                {PROVIDER_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Input id="model" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)} onBlur={() => model.trim() && model !== settings.model && void onUpdate({ model })} />
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
        <p className="text-xs text-muted-foreground">{saved ? 'Key saved (stored in the macOS Keychain, shared with the mca CLI). Paste a new one to replace it.' : 'Stored in the macOS Keychain; never shown again.'}</p>
      </div>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, settings, disabled, ...actions }: { open: boolean; onOpenChange(open: boolean): void; settings: SettingsInfo; disabled?: boolean } & SettingsActions) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{disabled ? 'Provider and model cannot change while a turn is running.' : 'Choose a provider and model, and save its API key.'}</DialogDescription>
        </DialogHeader>
        <ProviderForm settings={settings} disabled={disabled} {...actions} />
      </DialogContent>
    </Dialog>
  )
}
