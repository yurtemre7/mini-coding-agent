import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PromptInput } from './PromptInput'

const base = { busy: false, mode: 'default' as const, model: 'claude-x', models: { models: [] }, onModel: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), onMode: vi.fn(), onRewind: vi.fn() }

describe('PromptInput', () => {
  it('Enter sends and clears; Shift+Enter does not', () => {
    const onSend = vi.fn()
    render(<PromptInput {...base} onSend={onSend} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello')
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
})
