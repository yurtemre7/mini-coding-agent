import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PromptDialog } from './PermissionDialog'

const req = { kind: 'permission' as const, toolName: 'Bash', input: { command: 'npm test' }, suggestion: 'Bash(npm test:*)' }

describe('PromptDialog (permission)', () => {
  it('a very long command and rule are clipped, scrollable and wrapped so the dialog keeps its size', () => {
    const long = 'x'.repeat(5000)
    render(<PromptDialog request={{ ...req, input: { command: long }, suggestion: `Bash(${long}:*)` }} onDecision={vi.fn()} />)
    const rule = screen.getByTestId('suggestion')
    expect(rule.textContent!.length).toBeLessThan(400)
    expect(rule).toHaveClass('max-h-20', 'overflow-auto')
    expect(screen.getByTestId('subject').textContent!.length).toBeLessThanOrEqual(2001)
  })
  it('a dangerous command shows a warning, offers no session grant and says Run anyway', () => {
    const f = vi.fn()
    render(<PromptDialog request={{ ...req, input: { command: 'sudo rm -rf /' }, danger: true, reason: 'this command can delete the whole system or your home directory', suggestion: undefined }} onDecision={f} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be undone/)
    expect(screen.getByText('Dangerous command')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /for this session/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run anyway' }))
    expect(f).toHaveBeenCalledWith({ allow: true, scope: 'once' })
  })
  it('Yes -> once', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(f).toHaveBeenCalledWith({ allow: true, scope: 'once' })
  })
  it('Yes for this session -> session scope', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: /Allow for this session/ }))
    expect(f).toHaveBeenCalledWith({ allow: true, scope: 'session' })
  })
  it('No sends the feedback, or nothing when empty', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(f).toHaveBeenLastCalledWith({ allow: false })
    fireEvent.change(screen.getByPlaceholderText(/what to do instead/), { target: { value: ' use Edit ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(f).toHaveBeenLastCalledWith({ allow: false, feedback: 'use Edit' })
  })
  it('shows the command and renders nothing without a request', () => {
    const { rerender } = render(<PromptDialog request={req} onDecision={vi.fn()} />)
    expect(screen.getByText('npm test')).toBeInTheDocument()
    rerender(<PromptDialog request={null} onDecision={vi.fn()} />)
    expect(screen.queryByText('npm test')).toBeNull()
  })
  it('trust prompt lists the rules', () => {
    const f = vi.fn()
    render(<PromptDialog request={{ kind: 'trust', workspace: '/w', rules: ['Bash(ls:*)'] }} onDecision={f} />)
    expect(screen.getByText('Bash(ls:*)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trust workspace' }))
    expect(f).toHaveBeenCalledWith({ allow: true })
  })
})

describe('PromptDialog keyboard shortcuts', () => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const press = (key: string, o: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...(mac ? { metaKey: true } : { ctrlKey: true }), ...o })
  it('Mod+Enter allows once, Mod+Shift+Enter allows for the session, Escape denies with the typed feedback', () => {
    const f = vi.fn()
    const { unmount } = render(<PromptDialog request={req} onDecision={f} />)
    press('Enter')
    expect(f).toHaveBeenLastCalledWith({ allow: true, scope: 'once' })
    press('Enter', { shiftKey: true })
    expect(f).toHaveBeenLastCalledWith({ allow: true, scope: 'session' })
    fireEvent.change(screen.getByPlaceholderText(/Optional/), { target: { value: 'use pnpm' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(f).toHaveBeenLastCalledWith({ allow: false, feedback: 'use pnpm' })
    fireEvent.keyDown(window, { key: 'Enter' }) // a bare Enter never decides
    expect(f).toHaveBeenCalledTimes(3)
    unmount()
  })
  it('uses the configured keys and shows them on the buttons', () => {
    const f = vi.fn()
    const keys = { permAllowOnce: 'Alt+Y', permAllowSession: 'Alt+S', permDeny: 'Alt+N', planApprove: 'Mod+Enter', planReject: 'Escape' }
    render(<PromptDialog request={req} keys={keys} onDecision={f} />)
    fireEvent.keyDown(window, { key: 'y', altKey: true })
    expect(f).toHaveBeenLastCalledWith({ allow: true, scope: 'once' })
    fireEvent.keyDown(window, { key: 'n', altKey: true })
    expect(f).toHaveBeenLastCalledWith({ allow: false })
    expect(screen.getByRole('button', { name: 'Allow once' }).textContent).toMatch(/Alt/)
    press('Enter') // the default is no longer bound
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('a dangerous command cannot be allowed with a key, only denied', () => {
    const f = vi.fn()
    render(<PromptDialog request={{ ...req, input: { command: 'sudo rm -rf /' }, danger: true, suggestion: undefined }} onDecision={f} />)
    press('Enter')
    press('Enter', { shiftKey: true })
    expect(f).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(f).toHaveBeenCalledWith({ allow: false })
  })
  it('plan: approve and reject; trust: Escape declines and nothing trusts', () => {
    const f = vi.fn()
    const { rerender } = render(<PromptDialog request={{ kind: 'plan', plan: 'do it' }} onDecision={f} />)
    press('Enter')
    expect(f).toHaveBeenLastCalledWith({ allow: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(f).toHaveBeenLastCalledWith({ allow: false })
    f.mockClear()
    rerender(<PromptDialog request={{ kind: 'trust', workspace: '/w', rules: ['Bash(*)'] }} onDecision={f} />)
    press('Enter')
    expect(f).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(f).toHaveBeenCalledWith({ allow: false })
  })
})
