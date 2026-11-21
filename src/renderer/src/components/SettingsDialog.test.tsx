import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'

describe('SettingsDialog', () => {
  it('never renders a stored key: the input is empty and only says "Key saved"', () => {
    // even if a key leaked into the settings object, nothing renders it
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'keychain', openrouter: null }, key: 'sk-secret-123' } as any
    const { baseElement } = render(<SettingsDialog open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    const input = screen.getByLabelText('API key') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Key saved')
    expect(baseElement.innerHTML).not.toContain('sk-secret-123')
  })
  it('shows where the key was found, or that it was rejected, or that there is none', () => {
    const base = { provider: 'anthropic', model: 'm', effort: 'medium', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'dotenv', openrouter: null } } as const
    const props = { open: true, onOpenChange: vi.fn(), onUpdate: vi.fn(), onSaveKey: vi.fn() }
    const { rerender } = render(<SettingsDialog {...props} settings={base} />)
    expect(screen.getByRole('status')).toHaveTextContent('Key found in .env')
    rerender(<SettingsDialog {...props} settings={base} models={{ models: [], rejected: true, error: 'x' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Key rejected by Anthropic')
    rerender(<SettingsDialog {...props} settings={{ ...base, hasKey: { anthropic: false, openrouter: false }, keySource: { anthropic: null, openrouter: null } }} />)
    expect(screen.getByRole('status')).toHaveTextContent('No key yet')
  })
  it('save is disabled until a key is typed', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} settings={{ provider: 'openrouter', model: 'm', effort: 'medium', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } }} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    expect((screen.getByLabelText('API key') as HTMLInputElement).placeholder).toBe('Paste your API key')
  })
})
