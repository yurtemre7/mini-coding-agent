import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { McaApi, ViewState } from '../../shared/types'

const view: ViewState = { items: [], todos: [], changes: { turn: [], total: [] }, mode: 'default', provider: 'anthropic', model: 'm', workspace: null, mcp: [], busy: false, pending: null, seq: 0 }

const handlers = new Map<string, (p: any) => void>()
const menu = (a: string) => act(() => handlers.get('menu:action')?.(a))
const api = (hasKey: boolean, v: Partial<ViewState> = {}): McaApi => ({
  invoke: vi.fn(async (ch: string) => (ch === 'settings:get' ? { provider: 'anthropic', model: 'm', hasKey: { anthropic: hasKey, openrouter: false }, keySource: { anthropic: hasKey ? 'env' : null, openrouter: null } } : ch === 'settings:models' ? { models: ['m'] } : ch === 'workspace:overview' || ch === 'workspace:newest' ? [] : ch === 'skills:list' ? [] : { ...view, ...v })) as any,
  on: vi.fn((ch: string, cb: (p: any) => void) => (handlers.set(ch, cb), () => void handlers.delete(ch))) as any
})

describe('App', () => {
  beforeEach(() => {
    delete window.mca
  })

  it('explains itself when run outside Electron', () => {
    render(<App />)
    expect(screen.getByText(/must run inside the desktop app/)).toBeInTheDocument()
  })

  it('shows provider setup, not the chat, when no key is configured', async () => {
    window.mca = api(false)
    render(<App />)
    expect(await screen.findByText('Set up a provider')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Ask MCA/)).toBeNull()
  })

  it('shows the workspace chat once a key exists; send is disabled until a workspace is open', async () => {
    window.mca = api(true)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Open a workspace to start')).toBeDisabled()
  })

  it('folds the sidebar and opens the tools column from the layout controls', async () => {
    localStorage.clear()
    window.mca = api(true)
    render(<App />)
    expect(await screen.findByLabelText('Sidebar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tools')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hide the sidebar' }))
    expect(screen.queryByLabelText('Sidebar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /3 columns/ }))
    expect(screen.getByLabelText('Sidebar')).toBeInTheDocument()
    expect(screen.getByLabelText('Tools')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Terminal/ }))
    expect(screen.getByLabelText('Command')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 column/ }))
    expect(screen.queryByLabelText('Tools')).toBeNull()
    expect(screen.queryByLabelText('Sidebar')).toBeNull()
    menu('toggleSidebar')
    expect(screen.getByLabelText('Sidebar')).toBeInTheDocument()
    menu('togglePanel')
    expect(screen.getByLabelText('Tools')).toBeInTheDocument()
    menu('tabTerminal')
    expect(screen.getByLabelText('Command')).toBeInTheDocument()
  })

  it('CiP: opens in the size chosen in Settings; the CiP window is compact and a double-click opens the sidebar overlay', async () => {
    localStorage.clear()
    const a = api(true, { workspace: '/w' })
    window.mca = a
    const { unmount } = render(<App />)
    await screen.findByLabelText('Sidebar')
    fireEvent.click(screen.getByRole('button', { name: 'CiP' }))
    expect(a.invoke).toHaveBeenLastCalledWith('window:pip', 'phone', 0.6)
    menu('settings')
    fireEvent.click(await screen.findByRole('switch', { name: 'CiP in normal size' }))
    expect(localStorage.getItem('mca.cipSize')).toBe('normal')
    menu('togglePip')
    expect(a.invoke).toHaveBeenLastCalledWith('window:pip', 'normal', 0.6)
    unmount()

    window.history.replaceState(null, '', '/?pip=phone')
    try {
      render(<App />)
      await screen.findByLabelText('Quick folder')
      expect(screen.queryByLabelText('Sidebar')).toBeNull()
      expect(screen.queryByRole('button', { name: /3 columns/ })).toBeNull()
      fireEvent.doubleClick(screen.getByRole('button', { name: 'Leave CiP' }))
      expect(screen.queryByLabelText('Sidebar')).toBeNull() // double-clicks on controls are ignored
      fireEvent.doubleClick(screen.getByText(/Describe a change/))
      expect(screen.getByLabelText('Sidebar')).toBeInTheDocument()
      act(() => void window.dispatchEvent(new Event('blur')))
      expect(screen.queryByLabelText('Sidebar')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Switch CiP to normal size' }))
      expect(a.invoke).toHaveBeenLastCalledWith('window:pip', 'normal', 0.6)
      expect(localStorage.getItem('mca.cipSize')).toBe('normal')
      menu('togglePip')
      expect(a.invoke).toHaveBeenLastCalledWith('window:pip', 'off', 0.6)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('right-click opens the quick-actions menu with what fits the spot, unless the target handled it', async () => {
    localStorage.clear()
    const a = api(true, { workspace: '/w' })
    window.mca = a
    render(<App />)
    const field = await screen.findByLabelText('Message')
    fireEvent.contextMenu(field)
    expect(a.invoke).toHaveBeenCalledWith('window:contextMenu', { selection: false, editable: true })
    fireEvent.contextMenu(screen.getByText(/Describe a change/))
    expect(a.invoke).toHaveBeenLastCalledWith('window:contextMenu', { selection: false, editable: false })
    const n = (a.invoke as ReturnType<typeof vi.fn>).mock.calls.length
    const own = (e: Event) => e.preventDefault()
    field.addEventListener('contextmenu', own)
    fireEvent.contextMenu(field)
    expect((a.invoke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n)
  })

  it('native menu actions: Settings opens the dialog, Focus Message Field moves the cursor, unknown actions are ignored', async () => {
    localStorage.clear()
    window.mca = api(true, { workspace: '/w' })
    render(<App />)
    await screen.findByLabelText('Message')
    expect(screen.getByLabelText('Message')).not.toHaveFocus()
    menu('focusPrompt')
    expect(screen.getByLabelText('Message')).toHaveFocus()
    menu('rm -rf' as any)
    expect(screen.queryByRole('dialog')).toBeNull()
    menu('settings')
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })
})
