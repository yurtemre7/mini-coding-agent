import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McaApi, ViewState } from '../../shared/types'
import OverlayApp from './OverlayApp'

const view: ViewState = { items: [], todos: [], changes: { turn: [], total: [] }, mode: 'default', provider: 'anthropic', model: 'm', workspace: '/home/me/project', mcp: [], busy: false, pending: null, seq: 0 }
const handlers = new Map<string, (p: any) => void>()
const api = (v: Partial<ViewState> = {}) => {
  const invoke = vi.fn(async (ch: string) => (ch === 'session:getState' ? { ...view, ...v } : undefined))
  const on = vi.fn((ch: string, cb: (p: any) => void) => (handlers.set(ch, cb), () => void handlers.delete(ch)))
  window.mca = { invoke, on } as unknown as McaApi
  return invoke
}

describe('OverlayApp', () => {
  beforeEach(() => {
    handlers.clear()
    delete window.mca
    Element.prototype.scrollIntoView ??= () => {}
  })
  it('shows the project name and the chat, and sends what is typed', async () => {
    const invoke = api({ items: [{ kind: 'user', text: 'hi there' }] })
    render(<OverlayApp />)
    expect(await screen.findByText('project')).toBeInTheDocument()
    expect(screen.getByText('hi there')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'next question' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    expect(invoke).toHaveBeenCalledWith('session:send', 'next question', undefined)
  })
  it('without a project it points to the main window instead of a dead field', async () => {
    const invoke = api({ workspace: null })
    render(<OverlayApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the main window' }))
    expect(invoke).toHaveBeenCalledWith('app:showMain')
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })
  it('Hide and Esc ask the app to hide the floating chat', async () => {
    const invoke = api()
    render(<OverlayApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hide the floating chat' }))
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' })
    expect(invoke.mock.calls.filter(([c]) => c === 'overlay:hide')).toHaveLength(2)
  })
  it('shows a permission prompt and lets it be answered here; it closes when another window answers', async () => {
    const invoke = api({ pending: { id: 'p1', request: { kind: 'permission', toolName: 'Bash', input: { command: 'ls' } } } })
    render(<OverlayApp />)
    expect(await screen.findByText('Allow Bash?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Deny/ }))
    expect(invoke).toHaveBeenCalledWith('prompt:answer', 'p1', expect.objectContaining({ allow: false }))
  })
  it('drops its copy of a prompt that was answered in the main window', async () => {
    api({ pending: { id: 'p2', request: { kind: 'permission', toolName: 'Bash', input: { command: 'ls' } } } })
    render(<OverlayApp />)
    expect(await screen.findByText('Allow Bash?')).toBeInTheDocument()
    act(() => handlers.get('prompt:answered')?.('p2'))
    expect(screen.queryByText('Allow Bash?')).toBeNull()
  })
})
