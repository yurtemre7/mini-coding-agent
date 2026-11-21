import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  it('shows the current preference and asks for the next one', () => {
    const onChange = vi.fn()
    render(<ThemeToggle pref="light" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Theme: Light/ }))
    expect(onChange).toHaveBeenCalledWith('dark')
  })
})
