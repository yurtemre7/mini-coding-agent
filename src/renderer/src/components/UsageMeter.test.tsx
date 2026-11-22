import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { tokens } from '@/lib/tokens'
import { UsageMeter } from './UsageMeter'

describe('UsageMeter', () => {
  it('formats token counts', () => expect([tokens(950), tokens(45_200), tokens(1_000_000), tokens(1_250_000)]).toEqual(['950', '45k', '1M', '1.3M']))
  it('shows context fill and chat totals, and turns the bar red from 80%', () => {
    const { rerender } = render(<UsageMeter usage={{ contextTokens: 50_000, contextWindow: 200_000, totalIn: 120_000, totalOut: 8000 }} />)
    expect(screen.getByText('Context 50k / 200k (25%)')).toBeInTheDocument()
    expect(screen.getByText('This chat: 120k in · 8k out')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    rerender(<UsageMeter usage={{ contextTokens: 170_000, contextWindow: 200_000, totalIn: 0, totalOut: 0 }} />)
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-destructive')
    expect(screen.queryByText(/This chat/)).toBeNull()
  })
  it('shows the estimated cost, a lower bound when partial, and nothing when no request was priced', () => {
    const base = { contextTokens: 1, contextWindow: 100, totalIn: 10, totalOut: 1 }
    const { rerender } = render(<UsageMeter usage={{ ...base, totalCostUsd: 0.0042 }} />)
    expect(screen.getByText('Est. cost $0.0042')).toBeInTheDocument()
    rerender(<UsageMeter usage={{ ...base, totalCostUsd: 1.236, costPartial: true }} />)
    expect(screen.getByText('Est. cost ≥ $1.24')).toBeInTheDocument()
    rerender(<UsageMeter usage={{ ...base, costPartial: true }} />)
    expect(screen.queryByText(/Est. cost/)).toBeNull()
  })
})
