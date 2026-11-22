import type { Block, Message } from './provider/types'
import { isReminder } from '../shared/types'
import { toolSubject } from '../shared/guards'

const fence = (s: string): string => {
  const ticks = '`'.repeat(Math.max(3, (s.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length + 1), 0)))
  return `${ticks}\n${s}\n${ticks}`
}

const render = (b: Block): string => {
  if (b.type === 'text') return isReminder(b.text) ? '' : b.text.trim()
  if (b.type === 'image') return '_[image]_'
  if (b.type === 'tool_use') return `**Tool: ${b.name}**\n${fence(toolSubject(b.input) || JSON.stringify(b.input))}`
  return `_Result${b.is_error ? ' (error)' : ''}:_\n${fence(b.content.length > 2000 ? `${b.content.slice(0, 2000)}\n… (${b.content.length - 2000} more characters)` : b.content)}`
}

/** A readable Markdown copy of a chat. Injected context (<system-reminder>) is left out; long tool results are clipped. */
export function exportMarkdown(title: string, messages: Message[]): string {
  const parts = [`# ${title.replace(/\s+/g, ' ').trim() || 'Chat'}`]
  for (const m of messages) {
    const body = m.content.map(render).filter(Boolean).join('\n\n')
    if (body) parts.push(`## ${m.role === 'user' ? 'You' : 'MCA'}\n\n${body}`)
  }
  return `${parts.join('\n\n')}\n`
}
