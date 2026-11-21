import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Item } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export const PREVIEW_CHARS = 2000
type ToolItem = Extract<Item, { kind: 'tool' }>

const clip = (s: string) => (s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}\n… (${s.length - PREVIEW_CHARS} more characters)` : s)
const subject = (i: any): string => String(i?.command ?? i?.file_path ?? i?.pattern ?? i?.url ?? i?.path ?? '')

/** Raw HTML is not rendered (no rehype-raw); links open in the system browser through the window-open handler in main. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 break-words text-sm [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

function ToolCard({ tool, children }: { tool: ToolItem; children: React.ReactNode }) {
  return (
    <Collapsible className="rounded-md border bg-card text-sm">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{tool.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{subject(tool.input)}</span>
        <Badge variant={tool.isError ? 'destructive' : 'secondary'} className="ml-auto">
          {!tool.done ? 'running' : tool.isError ? 'error' : 'done'}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t px-3 py-2">
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{clip(JSON.stringify(tool.input, null, 2) ?? '')}</pre>
        {tool.done && <pre className="overflow-x-auto border-t pt-2 font-mono text-xs whitespace-pre-wrap">{clip(tool.result ?? '')}</pre>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

const keyOf = (i: Item, n: number) => (i.kind === 'tool' ? `tool-${i.id}` : `${i.kind}-${n}`)

function Row({ item, items }: { item: Item; items: Item[] }) {
  if (item.kind === 'user') return <div className="ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{item.text}</div>
  if (item.kind === 'text') return <Markdown>{item.text}</Markdown>
  if (item.kind === 'notice') return <p className={`text-xs ${item.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.message}</p>
  // subagent activity (parentId = the Task tool-use id) is nested under its parent card
  return (
    <ToolCard tool={item}>
      {items.filter((c) => 'parentId' in c && c.parentId === item.id).map((c, i) => (
        <div key={keyOf(c, i)} className="ml-3 border-l pl-3">
          <Row item={c} items={items} />
        </div>
      ))}
    </ToolCard>
  )
}

export function ChatTranscript({ items }: { items: Item[] }) {
  const end = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // follow the stream only while the user is already at the bottom
  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView?.({ block: 'end' })
  }, [items])
  return (
    <div
      className="flex-1 space-y-3 overflow-y-auto p-4"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {items.map((item, i) => (!('parentId' in item) || !item.parentId ? <Row key={keyOf(item, i)} item={item} items={items} /> : null))}
      <div ref={end} />
    </div>
  )
}
