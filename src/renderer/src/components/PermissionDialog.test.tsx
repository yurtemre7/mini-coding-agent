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
  it('Yes -> once', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(f).toHaveBeenCalledWith({ allow: true, scope: 'once' })
  })
  it('Yes for this session -> session scope', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: /for this session/ }))
    expect(f).toHaveBeenCalledWith({ allow: true, scope: 'session' })
  })
  it('No sends the feedback, or nothing when empty', () => {
    const f = vi.fn()
    render(<PromptDialog request={req} onDecision={f} />)
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(f).toHaveBeenLastCalledWith({ allow: false })
    fireEvent.change(screen.getByPlaceholderText(/what to do instead/), { target: { value: ' use Edit ' } })
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
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
