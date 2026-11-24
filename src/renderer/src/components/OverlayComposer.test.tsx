import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OverlayComposer } from './OverlayComposer'

const setup = (p: Partial<Parameters<typeof OverlayComposer>[0]> = {}) => {
  const f = { onSend: vi.fn(), onStop: vi.fn(), onEscape: vi.fn() }
  render(<OverlayComposer busy={false} disabled={false} {...f} {...p} />)
  return f
}

describe('OverlayComposer', () => {
  it('Enter sends the trimmed text and clears the field; Shift+Enter does not send', () => {
    const f = setup()
    const box = screen.getByLabelText('Message')
    fireEvent.change(box, { target: { value: '  hello  ' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(f.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(f.onSend).toHaveBeenCalledWith('hello')
    expect(box).toHaveValue('')
  })
  it('ignores empty text and Esc hides the window', () => {
    const f = setup()
    const box = screen.getByLabelText('Message')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(f.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(f.onEscape).toHaveBeenCalled()
  })
  it('offers Stop and Queue while a task runs', () => {
    const f = setup({ busy: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(f.onStop).toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
    expect(f.onSend).toHaveBeenCalledWith('next')
  })
  it('is disabled, and says why, until a project is open', () => {
    setup({ disabled: true })
    expect(screen.getByLabelText('Message')).toBeDisabled()
    expect(screen.getByPlaceholderText(/Open a project in the main window/)).toBeInTheDocument()
  })
})
