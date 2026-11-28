import type { Item } from '../../../shared/types'

type ToolItem = Extract<Item, { kind: 'tool' }>

/** Top-level items with runs of consecutive tool calls gathered into one entry. */
export function segments(items: Item[]): (Item | ToolItem[])[] {
  const out: (Item | ToolItem[])[] = []
  for (const i of items) {
    if ('parentId' in i && i.parentId) continue
    const last = out.at(-1)
    if (i.kind === 'tool' && Array.isArray(last)) last.push(i)
    else out.push(i.kind === 'tool' ? [i] : i)
  }
  return out
}
