import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'

describe('SettingsDialog', () => {
  it('never renders a stored key: the input is empty and only says "Key saved"', () => {
    // even if a key leaked into the settings object, nothing renders it
    const settings = { provider: 'anthropic', model: 'm', hasKey: { anthropic: true, openrouter: false }, key: 'sk-secret-123' } as any
    const { baseElement } = render(<SettingsDialog open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    const input = screen.getByLabelText('API key') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Key saved')
    expect(baseElement.innerHTML).not.toContain('sk-secret-123')
  })
  it('save is disabled until a key is typed', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} settings={{ provider: 'openrouter', model: 'm', hasKey: { anthropic: true, openrouter: false } }} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    expect((screen.getByLabelText('API key') as HTMLInputElement).placeholder).toBe('Paste your API key')
  })
})
