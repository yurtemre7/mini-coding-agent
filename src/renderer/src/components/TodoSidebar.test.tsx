import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TodoSidebar } from './TodoSidebar'

describe('TodoSidebar', () => {
  it('shows an empty state and then each todo with its status', () => {
    const { rerender } = render(<TodoSidebar todos={[]} />)
    expect(screen.getByText('None yet.')).toBeTruthy()
    rerender(<TodoSidebar todos={[{ content: 'write tests', status: 'completed' }, { content: 'ship', status: 'in_progress' }]} />)
    expect(screen.getByText('write tests').closest('p')?.dataset.status).toBe('completed')
    expect(screen.getByText('ship').closest('p')?.dataset.status).toBe('in_progress')
  })
})
