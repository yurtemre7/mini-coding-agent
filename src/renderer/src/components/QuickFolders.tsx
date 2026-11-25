import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

/** Compact workspace switcher: the recent workspaces, then the newest folders created next to them. `onOpen` refreshes the lists. */
export function QuickFolders({ workspace, recent, newest, disabled, onPick, onOpen }: { workspace: string | null; recent: string[]; newest: string[]; disabled?: boolean; onPick(path: string): void; onOpen?(): void }) {
  const fresh = newest.filter((p) => !recent.includes(p))
  return (
    <Select value={workspace ?? undefined} disabled={disabled} onValueChange={(p) => p !== workspace && onPick(p)} onOpenChange={(o) => o && onOpen?.()}>
      <SelectTrigger size="sm" aria-label="Quick folder" className="h-7 min-w-0 max-w-[12rem] text-xs" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <SelectValue placeholder="Choose a folder" />
      </SelectTrigger>
      <SelectContent>
        {recent.length > 0 && (
          <SelectGroup>
            <SelectLabel>Recent</SelectLabel>
            {recent.map((p) => (
              <SelectItem key={p} value={p} title={p}>
                {base(p)}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {fresh.length > 0 && (
          <>
            {recent.length > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>Newest folders</SelectLabel>
              {fresh.map((p) => (
                <SelectItem key={p} value={p} title={p}>
                  {base(p)}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  )
}
