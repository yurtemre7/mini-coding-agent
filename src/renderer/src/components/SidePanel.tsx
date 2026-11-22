import { FileDiff, GitBranch, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { PanelTab } from '@/lib/layout'
import { Button } from '@/components/ui/button'

const TABS: { id: PanelTab; label: string; icon: LucideIcon }[] = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal }
]

/** The right column: a tab bar and the active tab's content (all content stays mounted by the caller only as long as it is the active tab). */
export function SidePanel({ tab, onTab, badge, children }: { tab: PanelTab; onTab(t: PanelTab): void; badge?: Partial<Record<PanelTab, number>>; children: React.ReactNode }) {
  return (
    <>
      <div role="tablist" aria-label="Tool tabs" className="mb-3 flex gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Button key={id} role="tab" aria-selected={tab === id} size="sm" variant={tab === id ? 'secondary' : 'ghost'} onClick={() => onTab(id)}>
            <Icon className="mr-1 h-4 w-4" aria-hidden />
            {label}
            {!!badge?.[id] && <span className="ml-1 text-xs text-muted-foreground">({badge[id]})</span>}
          </Button>
        ))}
      </div>
      {children}
    </>
  )
}
