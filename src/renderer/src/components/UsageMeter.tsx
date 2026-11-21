import type { ViewState } from '../../../shared/types'
import { tokens } from '@/lib/tokens'

/** Context fill (the compaction trigger is at 80%) and this chat's running token totals. */
export function UsageMeter({ usage }: { usage: NonNullable<ViewState['usage']> }) {
  const pct = usage.contextWindow > 0 ? Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100)) : 0
  return (
    <div className="space-y-1 text-xs text-muted-foreground" aria-label="Usage">
      <p>
        Context {tokens(usage.contextTokens)} / {tokens(usage.contextWindow)} ({pct}%)
      </p>
      <div className="h-1 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${pct >= 80 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      {(usage.totalIn > 0 || usage.totalOut > 0) && (
        <p title="Tokens sent and received by requests in this chat since it was opened. Subagent requests are not counted.">
          This chat: {tokens(usage.totalIn)} in · {tokens(usage.totalOut)} out
        </p>
      )}
    </div>
  )
}
