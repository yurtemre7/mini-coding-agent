import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ago } from '@/lib/ago'
import { ChatsSidebar } from './ChatsSidebar'

const chat = { id: 'c1', title: 'Fix the bug', updated: Date.now() - 3 * 3_600_000, messageCount: 4 }
const other = { id: 'c2', title: 'Other chat', updated: Date.now() - 86_400_000, messageCount: 2 }
const props = () => ({
  workspaces: [
    { path: '/w/app', chats: [chat] },
    { path: '/w/other', chats: [other] },
    { path: '/w/third', chats: [] }
  ],
  workspace: '/w/app',
  disabled: false,
  onNewWorkspace: vi.fn(),
  onReorder: vi.fn(),
  onWorkspace: vi.fn(),
  onForget: vi.fn(),
  onChat: vi.fn(),
  onNew: vi.fn()
})

describe('ChatsSidebar', () => {
  beforeEach(() => localStorage.clear())
  it('pins a chat from any workspace to a Pinned list on top, remembers it, and unpins with one click', () => {
    const p = props()
    const { unmount } = render(<ChatsSidebar {...p} />)
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pin "Fix the bug"' }))
    const pinned = screen.getByRole('region', { name: 'Pinned' })
    expect(pinned).toHaveTextContent('Fix the bug')
    fireEvent.click(within(pinned).getByTitle('Fix the bug (app)'))
    expect(p.onChat).toHaveBeenCalledWith('/w/app', 'c1')
    unmount()
    render(<ChatsSidebar {...p} />) // remembered
    const again = screen.getByRole('region', { name: 'Pinned' })
    fireEvent.click(within(again).getByRole('button', { name: 'Unpin "Fix the bug"' }))
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull()
  })
  it('hovering "New workspace" refreshes and shows the newest folders; a click opens one', () => {
    const p = props()
    const onNewestHover = vi.fn()
    render(<ChatsSidebar {...p} newest={['/w/fresh']} onNewestHover={onNewestHover} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'New workspace' }).parentElement!)
    expect(onNewestHover).toHaveBeenCalled()
    const btn = screen.getByRole('button', { name: 'Open newest folder fresh' })
    expect(btn.parentElement).toHaveClass('hidden', 'group-hover/new:block')
    fireEvent.click(btn)
    expect(p.onWorkspace).toHaveBeenCalledWith('/w/fresh')
  })
  it('double-click on a chat activates it (open + focus the message field)', () => {
    const onActivate = vi.fn()
    render(<ChatsSidebar {...props()} onActivate={onActivate} />)
    fireEvent.doubleClick(screen.getByTitle('Fix the bug'))
    expect(onActivate).toHaveBeenCalledWith('/w/app', 'c1')
    expect(screen.queryByLabelText(/^Rename/)).toBeNull() // no inline editing from a double-click
  })
  it('renames a chat in place from its menu (Enter saves, Escape cancels, empty is ignored)', () => {
    const onRename = vi.fn()
    render(<ChatsSidebar {...props()} onRename={onRename} />)
    const edit = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions for "Fix the bug"' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rename "Fix the bug"' }))
      return screen.getByLabelText('Rename "Fix the bug"') as HTMLInputElement
    }
    const input = edit()
    expect(input.value).toBe('Fix the bug')
    fireEvent.change(input, { target: { value: '  Better   name ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('c1', 'Better name')
    expect(screen.queryByLabelText('Rename "Fix the bug"')).toBeNull()

    const second = edit()
    fireEvent.change(second, { target: { value: 'Nope' } })
    fireEvent.keyDown(second, { key: 'Escape' })
    const third = edit()
    fireEvent.change(third, { target: { value: '   ' } })
    fireEvent.blur(third)
    expect(onRename).toHaveBeenCalledTimes(1)
  })
  it('has a New workspace button on top; the open workspace is expanded, the others are collapsed tiles', () => {
    const p = props()
    render(<ChatsSidebar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    expect(p.onNewWorkspace).toHaveBeenCalled()
    expect(screen.getByText('Fix the bug')).toBeTruthy()
    expect(screen.getByText('3h ago')).toBeTruthy()
    expect(screen.queryByText('Other chat')).toBeNull()
    expect(screen.getByRole('button', { name: 'Collapse app' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Expand other' })).toHaveAttribute('aria-expanded', 'false')
  })
  it('expands and collapses tiles, and remembers the choice', () => {
    const { unmount } = render(<ChatsSidebar {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand other' }))
    expect(screen.getByText('Other chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse app' }))
    expect(screen.queryByText('Fix the bug')).toBeNull()
    unmount()
    render(<ChatsSidebar {...props()} />)
    expect(screen.getByText('Other chat')).toBeTruthy()
    expect(screen.queryByText('Fix the bug')).toBeNull()
  })
  it('opens another workspace from its name, and a chat or a new chat in any workspace', () => {
    const p = props()
    render(<ChatsSidebar {...p} />)
    fireEvent.click(screen.getByText('other'))
    expect(p.onWorkspace).toHaveBeenCalledWith('/w/other')
    fireEvent.click(screen.getByText('Other chat')) // the tile expanded when it was opened
    expect(p.onChat).toHaveBeenCalledWith('/w/other', 'c2')
    fireEvent.click(screen.getByRole('button', { name: 'New chat in other' }))
    expect(p.onNew).toHaveBeenCalledWith('/w/other')
    fireEvent.click(screen.getByText('Fix the bug'))
    expect(p.onChat).toHaveBeenCalledWith('/w/app', 'c1')
  })
  it('reorders by drag and drop and from the menu', () => {
    const p = props()
    render(<ChatsSidebar {...p} />)
    const row = (name: string) => screen.getByRole('button', { name: new RegExp(`(Expand|Collapse) ${name}`) }).parentElement!
    const dataTransfer = { setData: vi.fn() }
    fireEvent.dragStart(row('app'), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId('workspace-third'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('workspace-third'), { dataTransfer })
    expect(p.onReorder).toHaveBeenLastCalledWith(['/w/other', '/w/third', '/w/app'])
    fireEvent.dragStart(row('third'), { dataTransfer })
    fireEvent.drop(screen.getByTestId('workspace-app'), { dataTransfer })
    expect(p.onReorder).toHaveBeenLastCalledWith(['/w/third', '/w/app', '/w/other'])
    fireEvent.click(screen.getByRole('button', { name: 'Actions for other' }))
    expect(screen.getByRole('button', { name: 'Move down' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    expect(p.onReorder).toHaveBeenLastCalledWith(['/w/other', '/w/app', '/w/third'])
    fireEvent.click(screen.getByRole('button', { name: 'Actions for app' }))
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled() // already first
  })
  it('removes another workspace from the list; the open one explains why it cannot go', () => {
    const p = props()
    render(<ChatsSidebar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for other' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove other from the list' }))
    expect(p.onForget).toHaveBeenCalledWith('/w/other')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for app' }))
    expect(screen.getByRole('button', { name: 'Remove app from the list' })).toBeDisabled()
    expect(screen.getByText(/open workspace cannot be removed/)).toBeTruthy()
  })
  it('exports a chat and deletes it only after a confirmation', () => {
    const onDelete = vi.fn()
    const onExport = vi.fn()
    render(<ChatsSidebar {...props()} onDelete={onDelete} onExport={onExport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for "Fix the bug"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export "Fix the bug" as Markdown' }))
    expect(onExport).toHaveBeenCalledWith('c1')
    fireEvent.click(screen.getByRole('button', { name: 'Actions for "Fix the bug"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Fix the bug"' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/cannot be undone/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for "Fix the bug"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Fix the bug"' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat' }))
    expect(onDelete).toHaveBeenCalledWith('c1')
  })
  it('marks only the open chat of the open workspace, and keeps chat actions behind a menu', () => {
    const { container } = render(<ChatsSidebar {...props()} current="c1" onDelete={vi.fn()} onExport={vi.fn()} />)
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Delete "Fix the bug"' })).toBeNull()
  })
  it('is inert during a turn', () => {
    render(<ChatsSidebar {...props()} disabled />)
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New chat in app' })).toBeDisabled()
    expect(screen.getByText('other').closest('button')).toBeDisabled()
  })
  it('formats relative time', () => expect([ago(0, 30_000), ago(0, 5 * 60_000), ago(0, 2 * 86_400_000)]).toEqual(['just now', '5m ago', '2d ago']))
})
