import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, isThemePref, loadThemePref, nextThemePref, resolveTheme, saveThemePref } from './theme'

const mockMedia = (dark: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener() {}, removeEventListener() {} }))

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('theme', () => {
  it('resolves system from the OS and honours an explicit choice', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  it('cycles system → light → dark → system', () => {
    expect(nextThemePref('system')).toBe('light')
    expect(nextThemePref('light')).toBe('dark')
    expect(nextThemePref('dark')).toBe('system')
  })
  it('stores the preference and ignores junk', () => {
    expect(loadThemePref()).toBe('system')
    saveThemePref('dark')
    expect(loadThemePref()).toBe('dark')
    localStorage.setItem('mca.theme', 'purple')
    expect(loadThemePref()).toBe('system')
    expect(isThemePref('purple')).toBe(false)
  })
  it('survives unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(loadThemePref()).toBe('system')
    expect(() => saveThemePref('dark')).not.toThrow()
  })
  it('applyTheme sets the dark class and color-scheme, following the OS for system', () => {
    mockMedia(true)
    expect(applyTheme('system')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(applyTheme('light')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
