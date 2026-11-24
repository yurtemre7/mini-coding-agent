import { useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/** The floating chat's message field: Enter sends (or queues while a task runs), Shift+Enter adds a line, Esc hides the window. */
export function OverlayComposer({ busy, disabled, onSend, onStop, onEscape }: { busy: boolean; disabled: boolean; onSend(text: string): void; onStop(): void; onEscape(): void }) {
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }
  return (
    <div className="flex shrink-0 items-end gap-2 border-t p-2">
      <Textarea
        aria-label="Message"
        autoFocus
        rows={2}
        className="max-h-40 min-h-10 resize-none text-sm"
        placeholder={disabled ? 'Open a project in the main window first' : busy ? 'Type to queue the next message' : 'Ask something…'}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onEscape()
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
      />
      {busy && (
        <Button size="icon" variant="outline" aria-label="Stop" title="Stop" onClick={onStop}>
          <Square className="h-4 w-4" />
        </Button>
      )}
      <Button size="icon" aria-label={busy ? 'Queue message' : 'Send'} title={busy ? 'Queue message' : 'Send'} disabled={disabled || !text.trim()} onClick={send}>
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  )
}
