import { useState } from 'react'
import { RotateCcw, Send, Square } from 'lucide-react'
import { PERMISSION_MODES, type PermissionMode } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export interface PromptInputProps {
  busy: boolean
  disabled?: boolean // e.g. no workspace yet
  mode: PermissionMode
  onSend(text: string): void
  onStop(): void
  onMode(mode: PermissionMode): void
  onRewind(): void
}

export function PromptInput({ busy, disabled, mode, onSend, onStop, onMode, onRewind }: PromptInputProps) {
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
      <div className="flex items-center gap-2">
        <Select value={mode} onValueChange={(m) => onMode(m as PermissionMode)}>
          <SelectTrigger aria-label="Permission mode" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={busy || disabled} onClick={onRewind} title="Undo the last turn: restore its files and drop it from the conversation">
          <RotateCcw className="mr-2 h-4 w-4" />
          Rewind
        </Button>
        <div className="ml-auto">
          {busy ? (
            <Button variant="destructive" onClick={onStop}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button disabled={disabled || !text.trim()} onClick={submit}>
              <Send className="mr-2 h-4 w-4" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
