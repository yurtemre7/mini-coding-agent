import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { comboOf, conflictOf, DEFAULT_KEYS, formatCombo, isValidCombo, loadKeys, useKeys } from './keybindings'

const ev = (o: Partial<KeyboardEvent> & { key: string }) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

describe('keybindings', () => {
  beforeEach(() => localStorage.clear())
  it('turns key events into combos per platform and ignores bare modifiers', () => {
    expect(comboOf(ev({ key: 'Enter', metaKey: true }), true)).toBe('Mod+Enter')
    expect(comboOf(ev({ key: 'Enter', ctrlKey: true }), false)).toBe('Mod+Enter')
    expect(comboOf(ev({ key: 'Enter', ctrlKey: true }), true)).toBeNull() // Ctrl is not Mod on a Mac
    expect(comboOf(ev({ key: 'y', metaKey: true, shiftKey: true, altKey: true }), true)).toBe('Mod+Alt+Shift+Y')
    expect(comboOf(ev({ key: 'Shift', shiftKey: true }), true)).toBeNull()
    expect(comboOf(ev({ key: 'Escape' }), true)).toBe('Escape')
  })
  it('accepts only combos that cannot be typed into the feedback field', () => {
    for (const ok of ['Mod+Enter', 'Alt+Y', 'Escape', 'F5', 'Mod+Shift+D']) expect(isValidCombo(ok)).toBe(true)
    for (const bad of ['Y', 'Enter', 'Shift+Y', 'Space', 'F13', '']) expect(isValidCombo(bad)).toBe(false)
  })
  it('formats for the platform', () => {
    expect(formatCombo('Mod+Shift+Enter', true)).toBe('⌘⇧↵')
    expect(formatCombo('Mod+Shift+Enter', false)).toBe('Ctrl+Shift+Enter')
    expect(formatCombo('Escape', false)).toBe('Esc')
  })
  it('detects conflicts inside one dialog only', () => {
    expect(conflictOf(DEFAULT_KEYS, 'permDeny', 'Mod+Enter')).toBe('permAllowOnce')
    expect(conflictOf(DEFAULT_KEYS, 'planApprove', 'Mod+Shift+Enter')).toBeUndefined() // plan and permission dialogs never show together
    expect(conflictOf(DEFAULT_KEYS, 'permAllowOnce', 'Mod+Enter')).toBeUndefined()
  })
  it('defaults are valid and conflict-free; a broken or colliding store falls back', () => {
    expect(loadKeys()).toEqual(DEFAULT_KEYS)
    localStorage.setItem('mca.keys', '{"permAllowOnce":"Y","permDeny":"Alt+Y"}')
    expect(loadKeys()).toEqual({ ...DEFAULT_KEYS, permDeny: 'Alt+Y' }) // invalid entry dropped, valid kept
    localStorage.setItem('mca.keys', '{"permAllowOnce":"Alt+Y","permDeny":"Alt+Y"}')
    expect(loadKeys()).toEqual(DEFAULT_KEYS)
    localStorage.setItem('mca.keys', 'not json')
    expect(loadKeys()).toEqual(DEFAULT_KEYS)
  })
  it('useKeys validates, rejects conflicts, persists and resets', () => {
    const { result } = renderHook(() => useKeys())
    let r: string | null = null
    act(() => void (r = result.current.set('permAllowOnce', 'Y')))
    expect(r).toMatch(/needs/)
    act(() => void (r = result.current.set('permDeny', 'Mod+Enter')))
    expect(r).toMatch(/already used/)
    act(() => void (r = result.current.set('permAllowOnce', 'Alt+Y')))
    expect(r).toBeNull()
    expect(result.current.keys.permAllowOnce).toBe('Alt+Y')
    expect(JSON.parse(localStorage.getItem('mca.keys')!).permAllowOnce).toBe('Alt+Y')
    act(() => result.current.reset())
    expect(result.current.keys).toEqual(DEFAULT_KEYS)
  })
})
