import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { McaApi, ViewState } from '../../shared/types'

const view: ViewState = { items: [], todos: [], mode: 'default', provider: 'anthropic', model: 'm', workspace: null, busy: false, pending: null, seq: 0 }

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
})
