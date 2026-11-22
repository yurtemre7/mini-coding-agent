import { useCallback, useState } from 'react'

export type PanelTab = 'changes' | 'git' | 'terminal'
export interface Layout {
  /** left column: workspaces, chats, todos */
  sidebar: boolean
  /** right column: changes, git, terminal */
  panel: boolean
  tab: PanelTab
}
export const DEFAULT_LAYOUT: Layout = { sidebar: true, panel: false, tab: 'changes' }
const KEY = 'mca.layout'
const TABS: PanelTab[] = ['changes', 'git', 'terminal']

export function loadLayout(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null
    if (!v || typeof v !== 'object') return DEFAULT_LAYOUT
    return { sidebar: typeof v.sidebar === 'boolean' ? v.sidebar : true, panel: typeof v.panel === 'boolean' ? v.panel : false, tab: TABS.includes(v.tab as PanelTab) ? (v.tab as PanelTab) : 'changes' }
  } catch {
    return DEFAULT_LAYOUT
  }
}

/** Number of visible columns: the chat is always one. */
export const columns = (l: Layout): number => 1 + Number(l.sidebar) + Number(l.panel)

/** Panel visibility and the active tab, remembered per user. Storage may be unavailable; the layout still works for this run. */
export function useLayout() {
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const update = useCallback((patch: (l: Layout) => Layout) => {
    setLayout((l) => {
      const next = patch(l)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // not persisted
      }
      return next
    })
  }, [])
  return {
    layout,
    toggleSidebar: () => update((l) => ({ ...l, sidebar: !l.sidebar })),
    togglePanel: () => update((l) => ({ ...l, panel: !l.panel })),
    /** Opens the right column on a tab (or switches tab). */
    showTab: (tab: PanelTab) => update((l) => ({ ...l, panel: true, tab })),
    /** 3 = sidebar, chat and tools; 2 = chat and tools (sidebar folded away); 1 = chat only. */
    setColumns: (n: 1 | 2 | 3) => update((l) => ({ ...l, sidebar: n === 3, panel: n !== 1 })),
    setTab: (tab: PanelTab) => update((l) => ({ ...l, tab }))
  }
}
