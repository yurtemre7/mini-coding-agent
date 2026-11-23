import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { isMenuAction, MENU_ACTIONS, type MenuAction } from '../shared/types'
import { menuTemplate } from './menu'

const items = (t: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => t.flatMap((m) => (Array.isArray(m.submenu) ? items(m.submenu) : [m]))

describe('menuTemplate', () => {
  it('puts Settings in the macOS app menu with Cmd+, and in File elsewhere', () => {
    const mac = menuTemplate({ platform: 'darwin', name: 'MCA', send: vi.fn() })
    expect(mac[0].label).toBe('MCA')
    expect((mac[0].submenu as MenuItemConstructorOptions[]).some((i) => i.label === 'Settings…' && i.accelerator === 'CmdOrCtrl+,')).toBe(true)
    const win = menuTemplate({ platform: 'win32', name: 'MCA', send: vi.fn() })
    expect(win[0].label).toBe('File')
    expect(items(win).some((i) => i.label === 'Settings' && i.accelerator === 'CmdOrCtrl+,')).toBe(true)
  })
  it('every custom item sends a known action, every action has an item, and accelerators are unique', () => {
    const sent: MenuAction[] = []
    const all = items(menuTemplate({ platform: 'darwin', name: 'MCA', send: (a) => void sent.push(a) })).filter((i) => i.click)
    all.forEach((i) => (i.click as () => void)())
    expect([...sent].sort()).toEqual([...MENU_ACTIONS].sort())
    const acc = all.map((i) => i.accelerator).filter(Boolean)
    expect(new Set(acc).size).toBe(acc.length)
    expect(isMenuAction('settings')).toBe(true)
    expect(isMenuAction('rm -rf')).toBe(false)
  })
  it('keeps the Edit roles so copy and paste work', () => {
    const roles = items(menuTemplate({ platform: 'darwin', name: 'MCA', send: vi.fn() })).map((i) => i.role)
    expect(roles).toEqual(expect.arrayContaining(['copy', 'paste', 'selectAll', 'undo']))
  })
})
