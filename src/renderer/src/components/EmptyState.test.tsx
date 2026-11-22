import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('invites a new user to choose a folder when no workspace is open', () => {
    const open = vi.fn()
    render(<EmptyState workspace={null} onOpenWorkspace={open} />)
    fireEvent.click(screen.getByRole('button', { name: /choose a folder/i }))
    expect(open).toHaveBeenCalled()
  })

  it('prompts for a task once a workspace is open', () => {
    render(<EmptyState workspace="/p" onOpenWorkspace={() => {}} />)
    expect(screen.getByText('What should we work on?')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
