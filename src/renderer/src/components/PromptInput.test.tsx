import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PromptInput } from './PromptInput'

const base = { busy: false, mode: 'default' as const, model: 'claude-x', models: { models: [] }, onModel: vi.fn(), effort: 'medium' as const, onEffort: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), onMode: vi.fn(), onRewind: vi.fn() }

describe('PromptInput', () => {
  it('renders the effort select with Medium selected by default, disabled while busy', () => {
    const { rerender } = render(<PromptInput {...base} />)
    const sel = screen.getByRole('combobox', { name: 'Effort' })
    expect(sel).toHaveTextContent('Medium')
    expect(sel).toBeEnabled()
    rerender(<PromptInput {...base} busy />)
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeDisabled()
  })
  it('Enter sends and clears; Shift+Enter does not', () => {
    const onSend = vi.fn()
    render(<PromptInput {...base} onSend={onSend} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello', undefined)
    expect(box).toHaveValue('')
  })
  it('the model picker is disabled while busy', () => {
    render(<PromptInput {...base} busy />)
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
  })
  it('while busy: Stop replaces Send, Enter does nothing, Rewind is disabled', () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    render(<PromptInput {...base} busy onSend={onSend} onStop={onStop} />)
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull()
    expect(screen.getByRole('button', { name: /rewind/i })).toBeDisabled()
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalled()
  })
  it('slash autocomplete: filters, arrows + Tab complete, Escape closes, exact command sends', () => {
    const onSend = vi.fn()
    const commands = [
      { name: 'compact', description: 'Summarize', custom: false },
      { name: 'clear', description: 'Reset', custom: false },
      { name: 'fix', description: 'My fix', custom: true }
    ]
    render(<PromptInput {...base} onSend={onSend} commands={commands} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '/c' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box).toHaveValue('/clear ')
    fireEvent.change(box, { target: { value: '/f' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(box, { target: { value: '/fix' } })
    expect(screen.queryByRole('listbox')).toBeNull() // typed exactly: no menu, Enter sends
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('/fix', undefined)
  })
})
