import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueuedMessages } from './QueuedMessages'

describe('QueuedMessages', () => {
  it('renders nothing for an empty queue', () => {
    render(<QueuedMessages items={[]} onRemove={vi.fn()} />)
    expect(screen.queryByTestId('queue')).toBeNull()
  })
  it('lists messages in order and removes one on request', () => {
    const onRemove = vi.fn()
    render(<QueuedMessages items={[{ id: 4, text: 'first' }, { id: 7, text: '', files: [{ name: 'a.png', mime: 'image/png', data: 'x' }] }]} onRemove={onRemove} />)
    expect(screen.getByText(/Queued \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('Attachments only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message 2' }))
    expect(onRemove).toHaveBeenCalledWith(7)
  })
})
