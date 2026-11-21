import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChangeSummary } from '../../../shared/types'
import { DiffPanel } from './DiffPanel'

const c = (path: string, extra: Partial<ChangeSummary> = {}): ChangeSummary => ({ path, status: 'modified', additions: 2, deletions: 1, binary: false, tooLarge: false, ...extra })
const base = { changes: { turn: [c('src/a.ts')], total: [c('src/a.ts'), c('b.txt', { status: 'added', additions: 3, deletions: 0 })] }, busy: false, loadDiff: vi.fn(async () => '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n'), onRevert: vi.fn(async () => {}) }

describe('DiffPanel', () => {
  it('lists the files of the selected scope with counts', () => {
    render(<DiffPanel {...base} />)
    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.queryByText('b.txt')).toBeNull()
    expect(screen.getByText('+2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('b.txt')).toBeInTheDocument()
  })
  it('expanding a file fetches its diff for the scope and colors added and removed lines', async () => {
    const loadDiff = vi.fn(base.loadDiff)
    render(<DiffPanel {...base} loadDiff={loadDiff} />)
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(await screen.findByText('+new')).toHaveClass('text-green-600')
    expect(screen.getByText('-old')).toHaveClass('text-red-600')
    expect(loadDiff).toHaveBeenCalledWith('turn', 'src/a.ts')
  })
  it('a failing diff load shows the error inline', async () => {
    render(<DiffPanel {...base} loadDiff={async () => Promise.reject(new Error('gone'))} />)
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(await screen.findByText(/gone/)).toBeInTheDocument()
  })
  it('revert asks for confirmation and only then calls onRevert', async () => {
    const onRevert = vi.fn(async () => {})
    render(<DiffPanel {...base} onRevert={onRevert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revert src/a.ts' }))
    expect(onRevert).not.toHaveBeenCalled()
    expect(screen.getByText(/Edits you made since will be lost/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRevert).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Revert src/a.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revert' }))
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith('turn', 'src/a.ts'))
  })
  it('revert is disabled while a turn runs', () => {
    render(<DiffPanel {...base} busy />)
    expect(screen.getByRole('button', { name: 'Revert src/a.ts' })).toBeDisabled()
  })
  it('shows "No changes yet" when empty, and notes binary files', () => {
    const { rerender } = render(<DiffPanel {...base} changes={{ turn: [], total: [] }} />)
    expect(screen.getByText('No changes yet.')).toBeInTheDocument()
    rerender(<DiffPanel {...base} changes={{ turn: [c('i.png', { binary: true, additions: 0, deletions: 0 })], total: [] }} />)
    expect(screen.getByText('binary')).toBeInTheDocument()
  })
})
