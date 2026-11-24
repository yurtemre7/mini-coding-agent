import { Paperclip, X } from 'lucide-react'
import type { QueuedMessage } from '@/hooks/useMessageQueue'
import { Button } from '@/components/ui/button'

/** Messages waiting for the current task to finish; each can be removed before it is sent. */
export function QueuedMessages({ items, onRemove }: { items: QueuedMessage[]; onRemove(id: number): void }) {
  if (!items.length) return null
  return (
    <div data-testid="queue" className="mx-auto w-full max-w-3xl shrink-0 px-3">
      <p className="px-1 pb-1 text-xs text-muted-foreground">Queued ({items.length}): sent in order when the current task finishes</p>
      <ul className="flex flex-col gap-1">
        {items.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-1.5 text-sm">
            <span className="w-4 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{m.text || 'Attachments only'}</span>
            {!!m.files?.length && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Paperclip className="h-3 w-3" aria-hidden />
                {m.files.length}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Remove queued message ${i + 1}`} onClick={() => onRemove(m.id)}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
