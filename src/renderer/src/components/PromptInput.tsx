import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowUp, FileText, Paperclip, X, ClipboardList, FilePen, Gauge, Shield, ShieldOff, Square, Undo2, type LucideIcon } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS } from '@/lib/providers'
import { EFFORT_LEVELS, IMAGE_MIMES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type Attachment, PERMISSION_MODES, type CommandInfo, type Effort, type PermissionMode } from '../../../shared/types'
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
  onSend(text: string, attachments?: Attachment[]): void
  onStop(): void
  onMode(mode: PermissionMode): void
  onRewind(): void
  /** Slash commands offered while the text starts with `/`. */
  commands?: CommandInfo[]
}

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })

export function PromptInput({ busy, disabled, mode, model, models, onModel, effort, onEffort, onSend, onStop, onMode, onRewind, commands = [] }: PromptInputProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  // slash autocomplete: only while the first word is being typed
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const prefix = /^\/([\w-]*)$/.exec(text)?.[1]
  const matches = prefix === undefined || dismissed ? [] : commands.filter((c) => c.name.toLowerCase().startsWith(prefix.toLowerCase()))
  const open = matches.length > 0 && !(matches.length === 1 && matches[0].name === prefix) // an exactly typed command needs no menu
  const pick = (c: CommandInfo) => (setText(`/${c.name} `), setActive(0))
  const canSend = !!text.trim() || files.length > 0
  const submit = () => {
    if (busy || disabled || !canSend) return
    onSend(text, files.length ? files : undefined)
    setText('')
    setFiles([])
    setPreview(null)
    setError(null)
  }
  const add = async (list: File[]) => {
    if (disabled || !list.length) return
    const next: Attachment[] = []
    let err: string | null = null
    for (const f of list) {
      if (files.length + next.length >= MAX_ATTACHMENTS) err = `At most ${MAX_ATTACHMENTS} attachments.`
      else if (f.size > MAX_ATTACHMENT_BYTES) err = `${f.name || 'File'} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`
      else {
        const mime = f.type || 'text/plain'
        const ext = mime.split('/')[1]?.split('+')[0] ?? 'png'
        next.push({ name: f.name || `pasted-image-${Date.now()}.${ext}`, mime, data: await toBase64(f) })
      }
    }
    setError(err)
    if (next.length) setFiles((cur) => [...cur, ...next])
  }
  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files)
    if (!pasted.length) return // plain text paste behaves normally
    e.preventDefault()
    void add(pasted)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    void add(Array.from(e.dataTransfer.files))
  }
  const isImage = (a: Attachment) => IMAGE_MIMES.includes(a.mime)
  const shown = preview !== null ? files[preview] : undefined
  return (
    <div className="space-y-2 border-t p-3" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Attachments">
          {files.map((f, i) => (
            <div key={i} className="group relative flex items-center gap-2 rounded-md border bg-muted/40 p-1 pr-2 text-xs">
              <button type="button" className="flex items-center gap-2" title="Preview" onClick={() => setPreview(preview === i ? null : i)}>
                {isImage(f) ? <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} className="h-10 w-10 rounded object-cover" /> : <FileText className="m-2 h-6 w-6 text-muted-foreground" aria-hidden />}
                <span className="max-w-40 truncate">{f.name}</span>
              </button>
              <button type="button" aria-label={`Remove ${f.name}`} className="rounded p-0.5 hover:bg-accent" onClick={() => (setFiles(files.filter((_, j) => j !== i)), setPreview(null))}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      {shown && (
        <div className="max-h-64 overflow-auto rounded-md border bg-muted/20 p-2" data-testid="attachment-preview">
          {isImage(shown) ? <img src={`data:${shown.mime};base64,${shown.data}`} alt={`Preview of ${shown.name}`} className="max-h-60 max-w-full" /> : <pre className="text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{new TextDecoder().decode(Uint8Array.from(atob(shown.data), (c) => c.charCodeAt(0))).slice(0, 5000)}</pre>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {open && (
        <ul role="listbox" aria-label="Commands" className="max-h-48 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === active}>
              <button type="button" className={'flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-accent ' + (i === active ? 'bg-accent' : '')} onMouseDown={(e) => (e.preventDefault(), pick(c))}>
                <span className="font-mono">/{c.name}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{c.description}</span>
                {c.custom && <span className="ml-auto shrink-0 text-xs text-muted-foreground">custom</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        onPaste={onPaste}
        value={text}
        disabled={disabled}
        placeholder={disabled ? 'Open a workspace to start' : 'Ask MCA to work on your code (Enter to send, Shift+Enter for a new line)'}
        onChange={(e) => (setText(e.target.value), setActive(0), setDismissed(false))}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
              return
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              pick(matches[Math.min(active, matches.length - 1)])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDismissed(true)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select value={mode} disabled={disabled} onValueChange={(m) => onMode(m as PermissionMode)}>
          <SelectTrigger aria-label="Permission mode" className="w-40">
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
        <ModelCombobox value={model} list={models} disabled={busy} onSelect={onModel} className="w-44" />
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
        <input ref={picker} type="file" multiple hidden data-testid="file-input" onChange={(e) => (void add(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
        <Button variant="outline" size="icon" aria-label="Attach files" title="Attach files (or paste / drop images)" disabled={disabled} onClick={() => picker.current?.click()}>
          <Paperclip className="h-4 w-4" aria-hidden />
        </Button>
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
            <Button disabled={disabled || !canSend} onClick={submit}>
              <ArrowUp className="mr-2 h-4 w-4" aria-hidden />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
