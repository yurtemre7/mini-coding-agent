import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { nextThemePref, type ThemePref } from '@/lib/theme'

const LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const ICON = { system: Monitor, light: Sun, dark: Moon }

/** Cycles System → Light → Dark. */
export function ThemeToggle({ pref, onChange }: { pref: ThemePref; onChange(p: ThemePref): void }) {
  const Icon = ICON[pref]
  const next = nextThemePref(pref)
  return (
    <Button variant="ghost" onClick={() => onChange(next)} aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}.`} title={`Theme: ${LABEL[pref]}`}>
      <Icon className="mr-2 h-4 w-4" aria-hidden />
      {LABEL[pref]}
    </Button>
  )
}
