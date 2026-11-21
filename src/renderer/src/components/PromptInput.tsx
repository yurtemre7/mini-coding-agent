import { useState } from 'react'
import { ArrowUp, ClipboardList, FilePen, Gauge, Shield, ShieldOff, Square, Undo2, type LucideIcon } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS } from '@/lib/providers'
import { EFFORT_LEVELS, PERMISSION_MODES, type Effort, type PermissionMode } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = { default: Shield, acceptEdits: FilePen, plan: ClipboardList, bypassPermissions: ShieldOff }

export interface PromptInputProps {
  busy: boolean
  disabled?: boolean // e.g. no workspace yet
  mode: PermissionMode
  model: string
  models: ModelList
  onModel(model: string): void
  effort: Effort
  onEffort(effort: Effort): void
  onSend(text: string): void
  onStop(): void
  onMode(mode: PermissionMode): void
  onRewind(): void
}

export function PromptInput({ busy, disabled, mode, model, models, onModel, effort, onEffort, onSend, onStop, onMode, onRewind }: PromptInputProps) {
  const [text, setText] = useState('')
  const submit = () => {
    if (busy || disabled || !text.trim()) return
    onSend(text)
    setText('')
  }
  return (
    <div className="space-y-2 border-t p-3">
      <Textarea
        value={text}
        disabled={disabled}
        placeholder={disabled ? 'Open a workspace to start' : 'Ask MCA to work on your code (Enter to send, Shift+Enter for a new line)'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), submit())
        }}
      />
      <div className="flex min-w-0 items-center gap-2">
        <Select value={mode} disabled={disabled} onValueChange={(m) => onMode(m as PermissionMode)}>
          <SelectTrigger aria-label="Permission mode" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                <span className="flex items-center gap-2">
                  {(() => {
                    const Icon = MODE_ICONS[m]
                    return <Icon className="h-4 w-4" aria-hidden />
                  })()}
                  {m}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModelCombobox value={model} list={models} disabled={busy} onSelect={onModel} className="w-56" />
        <Select value={effort} disabled={busy} onValueChange={(e) => onEffort(e as Effort)}>
          <SelectTrigger aria-label="Effort" className="w-36 min-w-0 shrink">
            <Gauge className="h-4 w-4 shrink-0" aria-hidden />
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent>
            {EFFORT_LEVELS.map((e) => (
              <SelectItem key={e} value={e}>
                {EFFORT_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={busy || disabled} onClick={onRewind} title="Undo the last turn: restore its files and drop it from the conversation">
          <Undo2 className="mr-2 h-4 w-4" aria-hidden />
          Rewind
        </Button>
        <div className="ml-auto">
          {busy ? (
            <Button variant="destructive" onClick={onStop}>
              <Square className="mr-2 h-4 w-4" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button disabled={disabled || !text.trim()} onClick={submit}>
              <ArrowUp className="mr-2 h-4 w-4" aria-hidden />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
