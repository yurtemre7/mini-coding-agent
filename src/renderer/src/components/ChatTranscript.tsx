import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronRight, CircleX, FilePen, FilePlus, FileText, FolderSearch, Loader2, Paperclip, Search, SquareTerminal, User, Wrench, type LucideIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Item } from '../../../shared/types'
import { toolSubject } from '../../../shared/guards'
import { segments } from '@/lib/segments'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export const PREVIEW_CHARS = 2000
type ToolItem = Extract<Item, { kind: 'tool' }>

const TOOL_ICONS: Record<string, LucideIcon> = { Read: FileText, Write: FilePlus, Edit: FilePen, Glob: FolderSearch, Grep: Search, Bash: SquareTerminal }

const clip = (s: string) => (s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}\n… (${s.length - PREVIEW_CHARS} more characters)` : s)

/** Raw HTML is not rendered (no rehype-raw); links open in the system browser through the window-open handler in main. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 [overflow-wrap:anywhere] text-sm [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** Small status mark: a spinner while running, a red cross on error, nothing when it went fine. */
function StatusMark({ tools }: { tools: ToolItem[] }) {
  if (tools.some((t) => !t.done)) return <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="running" />
  if (tools.some((t) => t.isError)) return <CircleX className="h-3 w-3 shrink-0 text-destructive" aria-label="error" />
  return null
}

const triggerClass = 'group flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted'
const chevron = <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />

/** One tool call as a one-line row; collapsed it shows only the tool name (plus the subject inside a group). */
function ToolCard({ tool, subject = false, children }: { tool: ToolItem; subject?: boolean; children?: React.ReactNode }) {
  const Icon = TOOL_ICONS[tool.name] ?? Wrench
  const sub = toolSubject(tool.input)
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger className={triggerClass} title={sub}>
        {chevron}
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">{tool.name}</span>
        {subject && <span className="min-w-0 truncate font-mono">{sub}</span>}
        <StatusMark tools={[tool]} />
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 space-y-2 border-l py-1 pl-3 text-sm">
        {!subject && sub && <p className="font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground">{sub}</p>}
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap break-all">{clip(JSON.stringify(tool.input, null, 2) ?? '')}</pre>
        {tool.done && <pre className="overflow-x-auto border-t pt-2 font-mono text-xs whitespace-pre-wrap break-all">{clip(tool.result ?? '')}</pre>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

const keyOf = (i: Item, n: number) => (i.kind === 'tool' ? `tool-${i.id}` : `${i.kind}-${n}`)

function Row({ item, items }: { item: Item; items: Item[] }) {
  if (item.kind === 'user')
    return (
      <div className="ml-auto flex w-fit max-w-[80%] items-start justify-end gap-2">
        <div className="min-w-0 rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-primary-foreground">{item.text}
          {item.attachments && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.attachments.map((n, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs"><Paperclip className="h-3 w-3" aria-hidden />{n}</span>
              ))}
            </div>
          )}
        </div>
        <User className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    )
  if (item.kind === 'text')
    return (
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <Markdown>{item.text}</Markdown>
        </div>
      </div>
    )
  if (item.kind === 'notice') return <p className={`text-xs [overflow-wrap:anywhere] ${item.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.message}</p>
  return <ToolRow tool={item} items={items} />
}

/** subagent activity (parentId = the Task tool-use id) is nested under its parent card */
function ToolRow({ tool: item, items, subject }: { tool: ToolItem; items: Item[]; subject?: boolean }) {
  return (
    <ToolCard tool={item} subject={subject}>
      {items.filter((c) => 'parentId' in c && c.parentId === item.id).map((c, i) => (
        <div key={keyOf(c, i)} className="ml-3 border-l pl-3">
          <Row item={c} items={items} />
        </div>
      ))}
    </ToolCard>
  )
}

/** Consecutive tool calls folded into one row: "Bash ×3" or "Read, Bash"; expanding lists each call. */
function ToolGroup({ tools, items }: { tools: ToolItem[]; items: Item[] }) {
  const names = [...new Set(tools.map((t) => t.name))]
  const label = names.length === 1 ? `${names[0]} ×${tools.length}` : names.join(', ')
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger className={triggerClass}>
        {chevron}
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{label}</span>
        <StatusMark tools={tools} />
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 border-l pl-2">
        {tools.map((t) => (
          <ToolRow key={t.id} tool={t} items={items} subject />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** What the agent is doing right now, from the newest running tool or the last item. */
function activityOf(items: Item[]): string {
  const tool = [...items].reverse().find((i): i is ToolItem => i.kind === 'tool' && !i.done)
  if (tool) {
    const subject = toolSubject(tool.input)
    return `Running ${tool.name}${subject ? ` · ${subject.length > 60 ? `${subject.slice(0, 60)}…` : subject}` : ''}`
  }
  return items.at(-1)?.kind === 'text' ? 'Writing…' : 'Thinking…'
}

/** Live "the agent is working" row: spinner, current activity and the seconds since the turn started. */
export function WorkingIndicator({ items }: { items: Item[] }) {
  const [start] = useState(Date.now)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - start) / 1000))
  return (
    <div role="status" aria-live="polite" data-testid="working" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      <span className="min-w-0 truncate">{activityOf(items)}</span>
      <span className="shrink-0 tabular-nums">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>
    </div>
  )
}

export function ChatTranscript({ items, busy = false }: { items: Item[]; busy?: boolean }) {
  const end = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // follow the stream only while the user is already at the bottom
  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView?.({ block: 'end' })
  }, [items, busy])
  return (
    <div
      className="flex-1 space-y-3 overflow-y-auto p-4"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {segments(items).map((seg, i) =>
        !Array.isArray(seg) ? <Row key={keyOf(seg, i)} item={seg} items={items} /> : seg.length === 1 ? <ToolRow key={`tool-${seg[0].id}`} tool={seg[0]} items={items} /> : <ToolGroup key={`group-${seg[0].id}`} tools={seg} items={items} />
      )}
      {busy && <WorkingIndicator items={items} />}
      <div ref={end} />
    </div>
  )
}
