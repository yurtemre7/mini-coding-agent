import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalPanel } from './TerminalPanel'

const props = { log: '', running: false, hasWorkspace: true, onRun: vi.fn(), onStop: vi.fn(), onClear: vi.fn() }

describe('TerminalPanel', () => {
  it('runs a typed command on Enter, clears the input and recalls it with the arrow key', () => {
    const onRun = vi.fn()
    render(<TerminalPanel {...props} onRun={onRun} />)
    const input = screen.getByLabelText('Command')
    fireEvent.change(input, { target: { value: ' npm test ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith('npm test')
    expect(input).toHaveValue('')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('npm test')
  })
  it('shows Stop while a command runs and no workspace disables input', () => {
    const { rerender } = render(<TerminalPanel {...props} running log="out" />)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(props.onStop).toHaveBeenCalled()
    expect(screen.getByLabelText('Terminal output')).toHaveTextContent('out')
    rerender(<TerminalPanel {...props} hasWorkspace={false} />)
    expect(screen.getByLabelText('Command')).toBeDisabled()
    expect(screen.getByText('Open a workspace to use the terminal.')).toBeInTheDocument()
  })
})
