import { useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { ModelInfo } from '../../../shared/types'

export interface ModelList {
  models: ModelInfo[]
  loading?: boolean
  error?: string // fallback reason: the list is the defaults
  rejected?: boolean // the provider refused the key
}

/** Searchable model picker (Popover + Command). Any id can be typed and used, listed or not. */
export function ModelCombobox({ id, value, list, disabled, className, onSelect }: { id?: string; value: string; list: ModelList; disabled?: boolean; className?: string; onSelect(model: string): void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const q = typed.trim()
  const pick = (m: string) => {
    setOpen(false)
    if (m !== value) onSelect(m)
  }
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setTyped(''))}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} aria-label="Model" disabled={disabled} className={cn('justify-between font-mono text-xs', className)}>
          <span className="min-w-0 truncate">{value}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a model id…" value={typed} onValueChange={setTyped} />
          <CommandList>
            {list.loading && (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading models…
              </p>
            )}
            {list.error && <p className="px-3 py-2 text-xs [overflow-wrap:anywhere] text-muted-foreground">Could not load the model list ({list.error}). Showing defaults.</p>}
            <CommandEmpty>{q ? 'No listed model matches.' : 'No models.'}</CommandEmpty>
            {list.models.map((m) => (
              <CommandItem key={m.id} value={m.id} onSelect={() => pick(m.id)} className="font-mono text-xs">
                <Check className={cn('h-4 w-4 shrink-0', m.id === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={m.id}>{m.id}</span>
                {m.free && (
                  <Badge variant="secondary" className="ml-auto shrink-0 font-sans">
                    Free
                  </Badge>
                )}
              </CommandItem>
            ))}
            {q && !list.models.some((m) => m.id === q) && (
              <CommandItem forceMount value={`use:${q}`} onSelect={() => pick(q)} className="text-xs">
                <span className="min-w-0 truncate">Use &quot;{q}&quot;</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
