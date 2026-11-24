import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'

describe('SettingsDialog', () => {
  it('never renders a stored key: the input is empty and only says "Key saved"', () => {
    // even if a key leaked into the settings object, nothing renders it
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'keychain', openrouter: null }, key: 'sk-secret-123' } as any
    const { baseElement } = render(<SettingsDialog tab="provider" open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    const input = screen.getByLabelText('API key') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Key saved')
    expect(baseElement.innerHTML).not.toContain('sk-secret-123')
  })
  it('shows where the key was found, or that it was rejected, or that there is none', () => {
    const base = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'dotenv', openrouter: null } } as const
    const props = { open: true, onOpenChange: vi.fn(), onUpdate: vi.fn(), onSaveKey: vi.fn() }
    const { rerender } = render(<SettingsDialog tab="provider" {...props} settings={base} />)
    expect(screen.getByRole('status')).toHaveTextContent('Key found in .env')
    rerender(<SettingsDialog tab="provider" {...props} settings={base} models={{ models: [], rejected: true, error: 'x' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Key rejected by Anthropic')
    rerender(<SettingsDialog tab="provider" {...props} settings={{ ...base, hasKey: { anthropic: false, openrouter: false }, keySource: { anthropic: null, openrouter: null } }} />)
    expect(screen.getByRole('status')).toHaveTextContent('No key yet')
  })
  it('without a key it says where to get one, with a link to the right provider; with a key it does not', () => {
    const base = { provider: 'openrouter', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: false, openrouter: false }, keySource: { anthropic: null, openrouter: null } } as const
    const props = { open: true, onOpenChange: vi.fn(), onUpdate: vi.fn(), onSaveKey: vi.fn() }
    const { rerender } = render(<SettingsDialog tab="provider" {...props} settings={base} />)
    expect(screen.getByTestId('key-help')).toHaveTextContent('OpenRouter')
    expect(screen.getByRole('link', { name: 'Open the key page' })).toHaveAttribute('href', 'https://openrouter.ai/keys')
    rerender(<SettingsDialog tab="provider" {...props} settings={{ ...base, hasKey: { anthropic: false, openrouter: true }, keySource: { anthropic: null, openrouter: 'keychain' } }} />)
    expect(screen.queryByTestId('key-help')).toBeNull()
  })
  it('save is disabled until a key is typed', () => {
    render(<SettingsDialog tab="provider" open onOpenChange={vi.fn()} settings={{ provider: 'openrouter', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } }} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    expect((screen.getByLabelText('API key') as HTMLInputElement).placeholder).toBe('Paste your API key')
  })
  describe('tabs', () => {
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'keychain', openrouter: null } } as const
    const info = { name: 'mini-coding-agent', shortName: 'MCA', version: '0.1.0', platform: 'darwin', electronVersion: '40.0.0', license: 'MIT', repoUrl: 'https://github.com/yurtemre7/mini-coding-agent' } as const
    it('General: theme buttons and the notifications switch report changes', () => {
      const onChange = vi.fn()
      const onUpdate = vi.fn()
      render(<SettingsDialog open onOpenChange={vi.fn()} settings={settings} onUpdate={onUpdate} onSaveKey={vi.fn()} theme={{ pref: 'system', onChange }} />)
      expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
      expect(onChange).toHaveBeenCalledWith('dark')
      fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
      expect(onUpdate).toHaveBeenCalledWith({ notifications: false })
    })
    it('Skills: lists what was found with its source and reports a switch', () => {
      const onSkill = vi.fn()
      const skills = [
        { name: 'ponytail', description: 'ride', source: 'plugin', file: '/p/SKILL.md', enabled: true },
        { name: 'agy', description: 'other', source: 'antigravity', file: '/a/SKILL.md', enabled: false }
      ] as const
      render(<SettingsDialog tab="skills" open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} skills={[...skills]} onSkill={onSkill} />)
      expect(screen.getByText('/ponytail')).toBeInTheDocument()
      expect(screen.getByText('Claude plugin')).toBeInTheDocument()
      expect(screen.getByText('Antigravity')).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: 'Enable ponytail' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Enable agy' })).not.toBeChecked()
      fireEvent.click(screen.getByRole('switch', { name: 'Enable agy' }))
      expect(onSkill).toHaveBeenCalledWith('agy', true)
    })
    it('Skills: says so when none were found', () => {
      render(<SettingsDialog tab="skills" open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} />)
      expect(screen.getByText('No skills found.')).toBeInTheDocument()
    })
    it('About: version, license and the GitHub links', () => {
      render(<SettingsDialog tab="about" open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} info={info} />)
      expect(screen.getByText('0.1.0')).toBeInTheDocument()
      expect(screen.getByText('MIT')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Source code on GitHub/ })).toHaveAttribute('href', 'https://github.com/yurtemre7/mini-coding-agent')
      expect(screen.getByRole('link', { name: /Report an issue/ })).toHaveAttribute('href', 'https://github.com/yurtemre7/mini-coding-agent/issues')
    })
    it('switching tabs shows that section', () => {
      render(<SettingsDialog open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} info={info} />)
      expect(screen.queryByLabelText('API key')).toBeNull()
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Provider' }), { button: 0 })
      expect(screen.getByLabelText('API key')).toBeInTheDocument()
    })
  })
})

describe('SettingsDialog instructions', () => {
  it('saves custom instructions and can switch to replacing the built-in prompt', () => {
    const onUpdate = vi.fn()
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: 'Be brief.', systemReplace: false, defaultSystemPrompt: 'Base prompt.', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } } as const
    render(<SettingsDialog open onOpenChange={() => {}} settings={settings} onUpdate={onUpdate} onSaveKey={() => {}} tab="instructions" />)
    fireEvent.change(screen.getByLabelText('Custom instructions'), { target: { value: 'Answer in German.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    expect(onUpdate).toHaveBeenCalledWith({ systemPrompt: 'Answer in German.' })
    fireEvent.click(screen.getByRole('switch', { name: 'Replace the built-in prompt' }))
    expect(onUpdate).toHaveBeenCalledWith({ systemReplace: true })
    expect(screen.getByText('Base prompt.')).toBeInTheDocument()
  })
  it('shortcuts tab: captures the pressed keys, shows conflicts, resets', () => {
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'x', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } } as any
    const keys = { permAllowOnce: 'Mod+Enter', permAllowSession: 'Mod+Shift+Enter', permDeny: 'Escape', planApprove: 'Mod+Enter', planReject: 'Escape' }
    const set = vi.fn((_a: string, c: string) => (c === 'Y' ? 'needs a modifier' : null))
    const reset = vi.fn()
    const onOpenChange = vi.fn()
    render(<SettingsDialog tab="shortcuts" open onOpenChange={onOpenChange} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} keyEditor={{ keys, set, reset }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Allow once (permission)' }))
    expect(screen.getByText('Press keys…')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }) // a bare modifier is ignored
    expect(set).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'y' })
    expect(screen.getByRole('alert')).toHaveTextContent('needs a modifier')
    fireEvent.keyDown(window, { key: 'y', altKey: true })
    expect(set).toHaveBeenLastCalledWith('permAllowOnce', 'Alt+Y')
    expect(screen.queryByText('Press keys…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Deny (permission)' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(set).toHaveBeenLastCalledWith('permDeny', 'Escape')
    expect(onOpenChange).not.toHaveBeenCalled() // capturing Escape does not close the dialog
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(reset).toHaveBeenCalled()
    expect(screen.getByText('Menu shortcuts')).toBeInTheDocument()
  })
  it('general tab: the message field highlight is adjustable', () => {
    const settings = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'x', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } } as any
    const onChange = vi.fn()
    render(<SettingsDialog open onOpenChange={vi.fn()} settings={settings} onUpdate={vi.fn()} onSaveKey={vi.fn()} focus={{ value: 60, onChange }} />)
    const slider = screen.getByLabelText('Message field highlight') as HTMLInputElement
    expect(slider.value).toBe('60')
    fireEvent.change(slider, { target: { value: '30' } })
    expect(onChange).toHaveBeenCalledWith(30)
  })
})

describe('SettingsDialog context size', () => {
  const base = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'x', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } } as const
  it('shows the automatic size, explains it and offers smaller sizes', () => {
    Element.prototype.scrollIntoView ??= () => {} // jsdom lacks it; Radix Select calls it when opening
    const onUpdate = vi.fn()
    render(<SettingsDialog open onOpenChange={() => {}} settings={{ ...base, contextLimit: 0, contextMax: 200_000 }} onUpdate={onUpdate} onSaveKey={() => {}} />)
    const trigger = screen.getByRole('combobox', { name: 'Context size' })
    expect(trigger).toHaveTextContent('Automatic (200k)')
    expect(screen.getByText(/This model supports up to 200k/)).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Maximum (1M)' })).toHaveAttribute('aria-disabled', 'true') // above what the model supports
    fireEvent.click(screen.getByRole('option', { name: 'Small (100k)' }))
    expect(onUpdate).toHaveBeenCalledWith({ contextLimit: 100_000 })
  })
  it('shows the chosen cap', () => {
    render(<SettingsDialog open onOpenChange={() => {}} settings={{ ...base, contextLimit: 500_000, contextMax: 1_000_000 }} onUpdate={vi.fn()} onSaveKey={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Context size' })).toHaveTextContent('Large (500k)')
  })
})

describe('SettingsDialog floating chat', () => {
  const base = { provider: 'anthropic', model: 'm', effort: 'medium', notifications: true, systemPrompt: '', systemReplace: false, defaultSystemPrompt: 'x', hasKey: { anthropic: true, openrouter: false }, keySource: { anthropic: 'env', openrouter: null } } as const
  it('is off by default and turns on with the switch', () => {
    const onUpdate = vi.fn()
    render(<SettingsDialog open onOpenChange={() => {}} settings={{ ...base, overlay: false }} onUpdate={onUpdate} onSaveKey={() => {}} />)
    expect(screen.queryByRole('combobox', { name: 'Floating chat shortcut' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Floating chat' }))
    expect(onUpdate).toHaveBeenCalledWith({ overlay: true })
  })
  it('when on, shows the shortcut and explains the full-screen limit in plain words', () => {
    render(<SettingsDialog open onOpenChange={() => {}} settings={{ ...base, overlay: true, overlayShortcut: 'Alt+Shift+M' }} onUpdate={vi.fn()} onSaveKey={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Floating chat shortcut' })).toHaveTextContent('Alt + Shift + M')
    expect(screen.getByText(/Borderless or Windowed fullscreen/)).toBeInTheDocument()
  })
})
