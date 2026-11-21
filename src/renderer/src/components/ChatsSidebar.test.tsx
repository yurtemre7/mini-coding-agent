import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ago, ChatsSidebar } from './ChatsSidebar'

describe('ChatsSidebar', () => {
  const props = { workspace: '/w/app', recent: ['/w/app', '/w/other'], chats: [{ id: 'c1', title: 'Fix the bug', updated: Date.now() - 3 * 3_600_000, messageCount: 4 }], disabled: false, onWorkspace: vi.fn(), onChat: vi.fn(), onNew: vi.fn() }
  it('lists recent workspaces and chats; clicks resume, switch and start a new chat', () => {
    render(<ChatsSidebar {...props} />)
    fireEvent.click(screen.getByText('other'))
    fireEvent.click(screen.getByText('Fix the bug'))
    fireEvent.click(screen.getByText('New chat'))
    expect(props.onWorkspace).toHaveBeenCalledWith('/w/other')
    expect(props.onChat).toHaveBeenCalledWith('c1')
    expect(props.onNew).toHaveBeenCalled()
    expect(screen.getByText('3h ago')).toBeTruthy()
  })
  it('is inert during a turn', () => {
    render(<ChatsSidebar {...props} disabled />)
    expect(screen.getByText('New chat').closest('button')).toBeDisabled()
    expect(screen.getByText('other').closest('button')).toBeDisabled()
  })
  it('formats relative time', () => expect([ago(0, 30_000), ago(0, 5 * 60_000), ago(0, 2 * 86_400_000)]).toEqual(['just now', '5m ago', '2d ago']))
})
