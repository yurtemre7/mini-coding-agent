import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { rankFiles } from '@/lib/rankFiles'
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
  it('while busy: Stop replaces Send, Rewind is disabled, Enter queues the message', () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    render(<PromptInput {...base} busy onSend={onSend} onStop={onStop} />)
    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Queue message' })).toBeNull() // nothing typed yet
    expect(screen.getByRole('button', { name: /rewind/i })).toBeDisabled()
    const box = screen.getByRole('textbox')
    expect(box).toHaveAttribute('placeholder', expect.stringMatching(/Queue a message/))
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('x', undefined)
    expect(box).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalled()
  })
  it('while busy: the Queue button queues, and slash commands are refused', () => {
    const onSend = vi.fn()
    render(<PromptInput {...base} busy onSend={onSend} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'later' } })
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
    expect(onSend).toHaveBeenCalledWith('later', undefined)
    fireEvent.change(box, { target: { value: '/mode plan' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be queued/)
    expect(box).toHaveValue('/mode plan')
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
  describe('@ file mentions', () => {
    const files = ['src/app/main.ts', 'src/lib/util.ts', 'README.md', 'docs/main-notes.md']
    it('inserts file names literally, even with replacement patterns like $& in them', async () => {
      render(<PromptInput {...base} listFiles={async () => ['a/$&x.ts']} />)
      const box = screen.getByRole('textbox')
      fireEvent.change(box, { target: { value: 'see @x' } })
      await screen.findAllByRole('option')
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(box).toHaveValue('see @a/$&x.ts ')
    })
    it('typing @ offers workspace files, Enter inserts the path, and the list loads once', async () => {
      const listFiles = vi.fn(async () => files)
      render(<PromptInput {...base} listFiles={listFiles} />)
      const box = screen.getByRole('textbox')
      fireEvent.change(box, { target: { value: 'look at @mai' } })
      const opts = await screen.findAllByRole('option')
      expect(opts[0]).toHaveTextContent('main.ts')
      expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument()
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(box).toHaveValue('look at @src/app/main.ts ')
      fireEvent.change(box, { target: { value: 'and @READ' } })
      await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('README.md'))
      expect(listFiles).toHaveBeenCalledTimes(1)
    })
    it('an email address or a plain word does not open the menu, and Escape closes it', async () => {
      render(<PromptInput {...base} listFiles={async () => files} />)
      const box = screen.getByRole('textbox')
      fireEvent.change(box, { target: { value: 'mail me@example.com' } })
      expect(screen.queryByRole('listbox')).toBeNull()
      fireEvent.change(box, { target: { value: '@' } })
      await screen.findAllByRole('option')
      fireEvent.keyDown(box, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
    })
    it('the @ button starts a mention', async () => {
      render(<PromptInput {...base} listFiles={async () => files} />)
      fireEvent.click(screen.getByRole('button', { name: 'Mention a file' }))
      expect(screen.getByRole('textbox')).toHaveValue('@')
      expect(await screen.findAllByRole('option')).toHaveLength(4)
    })
    it('rankFiles puts name prefixes first, then name and path matches, at most 8', () => {
      expect(rankFiles(files, 'main')).toEqual(['src/app/main.ts', 'docs/main-notes.md'])
      expect(rankFiles(files, 'lib')).toEqual(['src/lib/util.ts'])
      expect(rankFiles(files, 'zzz')).toEqual([])
      expect(rankFiles(Array.from({ length: 20 }, (_, i) => `f${i}.ts`), '')).toHaveLength(8)
    })
  })
  it('dropping files highlights the composer, shows a hint and attaches them', async () => {
    render(<PromptInput {...base} />)
    const box = screen.getByTestId('composer')
    fireEvent.dragOver(box)
    expect(screen.getByRole('status')).toHaveTextContent('Drop images or files')
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' })
    fireEvent.drop(box, { dataTransfer: { files: [file] } })
    expect(screen.queryByRole('status')).toBeNull()
    expect(await screen.findByText('note.txt')).toBeInTheDocument()
  })
  it('moves the cursor into the field when the focus signal changes, but not on the first render', () => {
    const { rerender } = render(<PromptInput {...base} focusSignal={0} />)
    expect(screen.getByLabelText('Message')).not.toHaveFocus()
    rerender(<PromptInput {...base} focusSignal={1} />)
    expect(screen.getByLabelText('Message')).toHaveFocus()
  })
  it('highlights the composer with the configured strength only while focused', () => {
    render(<PromptInput {...base} focusStrength={40} />)
    const box = screen.getByTestId('composer')
    expect(box.style.boxShadow).toBe('')
    fireEvent.focus(screen.getByLabelText('Message'))
    expect(box.getAttribute('style')).toContain('40%')
    fireEvent.blur(screen.getByLabelText('Message'))
    expect(box.style.boxShadow).toBe('')
  })
})
