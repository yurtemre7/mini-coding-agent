import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { clampStrength, DEFAULT_FOCUS_STRENGTH, loadFocusStrength, useFocusStrength } from './focusStrength'

describe('focus strength', () => {
  beforeEach(() => localStorage.clear())
  it('defaults below 100 and clamps anything stored', () => {
    expect(loadFocusStrength()).toBe(DEFAULT_FOCUS_STRENGTH)
    expect(DEFAULT_FOCUS_STRENGTH).toBeLessThan(100)
    expect(clampStrength(250)).toBe(100)
    expect(clampStrength(-5)).toBe(0)
    expect(clampStrength('abc')).toBe(DEFAULT_FOCUS_STRENGTH)
    localStorage.setItem('mca.focusStrength', 'junk')
    expect(loadFocusStrength()).toBe(DEFAULT_FOCUS_STRENGTH)
  })
  it('is saved when changed', () => {
    const { result } = renderHook(() => useFocusStrength())
    act(() => result.current.set(30))
    expect(result.current.value).toBe(30)
    expect(localStorage.getItem('mca.focusStrength')).toBe('30')
    expect(loadFocusStrength()).toBe(30)
  })
})
