import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowUp, AtSign, FileText, ImagePlus, Paperclip, X, ClipboardList, FilePen, Gauge, Shield, ShieldOff, Square, Undo2, type LucideIcon } from 'lucide-react'
import { ModelCombobox, type ModelList } from '@/components/ModelCombobox'
import { EFFORT_LABELS } from '@/lib/providers'
import { rankFiles } from '@/lib/rankFiles'
import { EFFORT_LEVELS, IMAGE_MIMES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type Attachment, PERMISSION_MODES, type CommandInfo, type Effort, type PermissionMode } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = { default: Shield, acceptEdits: FilePen, plan: ClipboardList, bypassPermissions: ShieldOff }

export interface PromptInputProps {
  busy: boolean
  /** Moves the cursor into the field whenever this number changes (not on the first render). */
  focusSignal?: number
  /** Highlight strength (0-100 %) while the field has the cursor. */
  focusStrength?: number
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
  /** Workspace files for `@` mentions; called the first time `@` is typed. */
  listFiles?: () => Promise<string[]>
}

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })

export function PromptInput({ focusSignal = 0, focusStrength = 60, busy, disabled, mode, model, models, onModel, effort, onEffort, onSend, onStop, onMode, onRewind, commands = [], listFiles }: PromptInputProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  // one autocomplete menu for `/commands` (first word) and `@file` mentions (last word)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileList, setFileList] = useState<string[] | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (focusSignal > 0) area.current?.focus()
  }, [focusSignal])
  const prefix = /^\/([\w-]*)$/.exec(text)?.[1]
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1]
  useEffect(() => {
    if (mention === undefined || fileList || !listFiles) return
    let live = true
    listFiles().then((l) => live && setFileList(l), () => live && setFileList([]))
    return () => {
      live = false
    }
  }, [mention === undefined, fileList, listFiles]) // eslint-disable-line react-hooks/exhaustive-deps
  type Item = { key: string; label: string; detail?: string; tag?: string; apply: () => void }
  const items: Item[] = dismissed
    ? []
    : prefix !== undefined
      ? commands
          .filter((c) => c.name.toLowerCase().startsWith(prefix.toLowerCase()) && !(prefix === c.name)) // an exactly typed command needs no menu
          .map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description, tag: c.custom ? 'custom' : undefined, apply: () => setText(`/${c.name} `) }))
      : mention !== undefined && fileList
        ? rankFiles(fileList, mention).map((f) => ({ key: f, label: f.slice(f.lastIndexOf('/') + 1), detail: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : undefined, apply: () => setText(text.replace(/@[^\s@]*$/, () => `@${f} `)) }))
        : []
  const open = items.length > 0
  const pick = (it: Item) => (it.apply(), setActive(0), area.current?.focus())
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
    setDragging(false)
    void add(Array.from(e.dataTransfer.files))
  }
  const isImage = (a: Attachment) => IMAGE_MIMES.includes(a.mime)
  const shown = preview !== null ? files[preview] : undefined
  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div
        data-testid="composer"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={focused && !dragging ? { borderColor: `color-mix(in oklab, var(--ring) ${focusStrength}%, transparent)`, boxShadow: `0 0 0 3px color-mix(in oklab, var(--ring) ${Math.round(focusStrength / 2)}%, transparent)` } : undefined}
        className={'relative mx-auto flex w-full max-w-3xl flex-col gap-1 rounded-2xl border bg-surface p-2 shadow-float transition-[box-shadow,border-color] duration-150 ' + (dragging ? 'border-primary ring-[3px] ring-primary/30' : '')}
        onDragOver={(e) => (e.preventDefault(), !disabled && setDragging(true))}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && (
          <div role="status" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl bg-surface/90 text-sm font-medium">
            <ImagePlus className="h-4 w-4" aria-hidden />
            Drop images or files to attach
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attachments">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1 pr-1.5 text-xs">
                <button type="button" className="flex items-center gap-2 rounded" title="Preview" onClick={() => setPreview(preview === i ? null : i)}>
                  {isImage(f) ? <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} className="h-9 w-9 rounded-md object-cover" /> : <FileText className="m-1.5 h-6 w-6 text-muted-foreground" aria-hidden />}
                  <span className="max-w-40 truncate">{f.name}</span>
                </button>
                <button type="button" aria-label={`Remove ${f.name}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => (setFiles(files.filter((_, j) => j !== i)), setPreview(null))}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        {shown && (
          <div className="max-h-64 overflow-auto rounded-lg border bg-muted/20 p-2" data-testid="attachment-preview">
            {isImage(shown) ? <img src={`data:${shown.mime};base64,${shown.data}`} alt={`Preview of ${shown.name}`} className="max-h-60 max-w-full" /> : <pre className="text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{new TextDecoder().decode(Uint8Array.from(atob(shown.data), (c) => c.charCodeAt(0))).slice(0, 5000)}</pre>}
          </div>
        )}
        {error && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}
        {open && (
          <ul role="listbox" aria-label={prefix !== undefined ? 'Commands' : 'Files'} className="max-h-48 overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
            {items.map((it, i) => (
              <li key={it.key} role="option" aria-selected={i === active}>
                <button type="button" className={'flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-accent ' + (i === active ? 'bg-accent' : '')} onMouseDown={(e) => (e.preventDefault(), pick(it))}>
                  <span className={prefix !== undefined ? 'font-mono' : 'shrink-0 font-medium'}>{it.label}</span>
                  {it.detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{it.detail}</span>}
                  {it.tag && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{it.tag}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={area}
          rows={1}
          onPaste={onPaste}
          value={text}
          disabled={disabled}
          aria-label="Message"
          className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          placeholder={disabled ? 'Open a workspace to start' : 'Ask MCA to work on your code. Type / for commands, @ for files.'}
          onChange={(e) => (setText(e.target.value), setActive(0), setDismissed(false))}
          onKeyDown={(e) => {
            if (open && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault()
                pick(items[Math.min(active, items.length - 1)])
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
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <input ref={picker} type="file" multiple hidden data-testid="file-input" onChange={(e) => (void add(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="Attach files" title="Attach files (or paste / drop images)" disabled={disabled} onClick={() => picker.current?.click()}>
            <Paperclip className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="Mention a file" title="Mention a workspace file" disabled={disabled} onClick={() => (setText((t) => (/(^|\s)$/.test(t) ? `${t}@` : `${t} @`)), setActive(0), setDismissed(false), area.current?.focus())}>
            <AtSign className="h-4 w-4" aria-hidden />
          </Button>
          <Select value={mode} disabled={disabled} onValueChange={(m) => onMode(m as PermissionMode)}>
            <SelectTrigger aria-label="Permission mode" className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent dark:bg-transparent">
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
          <ModelCombobox value={model} list={models} disabled={busy} onSelect={onModel} className="h-8 w-40 border-0 bg-transparent text-xs shadow-none hover:bg-accent dark:bg-transparent" />
          <Select value={effort} disabled={busy} onValueChange={(e) => onEffort(e as Effort)}>
            <SelectTrigger aria-label="Effort" className="h-8 w-auto min-w-0 shrink gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent dark:bg-transparent">
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
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" disabled={busy || disabled} onClick={onRewind} title="Undo the last turn: restore its files and drop it from the conversation">
              <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Rewind
            </Button>
            {busy ? (
              <Button variant="destructive" size="icon" className="h-8 w-8 rounded-full" aria-label="Stop" title="Stop" onClick={onStop}>
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button size="icon" className="h-8 w-8 rounded-full" aria-label="Send" title="Send (Enter)" disabled={disabled || !canSend} onClick={submit}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
