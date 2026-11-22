import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { columns, DEFAULT_LAYOUT, loadLayout, useLayout } from './layout'

beforeEach(() => localStorage.clear())

describe('layout', () => {
  it('falls back to defaults on missing or garbage storage', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
    localStorage.setItem('mca.layout', '{"sidebar":"x","tab":"nope"}')
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
    localStorage.setItem('mca.layout', 'not json')
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
  })
  it('toggles panels, switches presets and remembers the choice', () => {
    const { result } = renderHook(() => useLayout())
    expect(columns(result.current.layout)).toBe(2) // sidebar + chat
    act(() => result.current.setColumns(3))
    expect(columns(result.current.layout)).toBe(3)
    act(() => result.current.toggleSidebar())
    expect(result.current.layout).toMatchObject({ sidebar: false, panel: true })
    act(() => result.current.showTab('git'))
    expect(loadLayout()).toMatchObject({ panel: true, tab: 'git' })
    act(() => result.current.setColumns(1))
    expect(columns(result.current.layout)).toBe(1)
    act(() => result.current.setColumns(2))
    expect(result.current.layout).toMatchObject({ sidebar: false, panel: true })
  })
})
