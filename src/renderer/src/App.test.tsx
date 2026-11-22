import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { McaApi, ViewState } from '../../shared/types'

const view: ViewState = { items: [], todos: [], changes: { turn: [], total: [] }, mode: 'default', provider: 'anthropic', model: 'm', workspace: null, mcp: [], busy: false, pending: null, seq: 0 }

const api = (hasKey: boolean): McaApi => ({
  invoke: vi.fn(async (ch: string) => (ch === 'settings:get' ? { provider: 'anthropic', model: 'm', hasKey: { anthropic: hasKey, openrouter: false }, keySource: { anthropic: hasKey ? 'env' : null, openrouter: null } } : ch === 'settings:models' ? { models: ['m'] } : ch === 'workspace:recent' || ch === 'session:list' ? [] : view)) as any,
  on: vi.fn(() => () => {})
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
    expect(await screen.findByText('Open workspace')).toBeInTheDocument()
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
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(screen.getByLabelText('Sidebar')).toBeInTheDocument()
  })
})
