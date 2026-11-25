import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { isMenuAction, MENU_ACTIONS, type MenuAction } from '../shared/types'
import { contextMenuTemplate, menuTemplate } from './menu'

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
  it('right-click menu: edit roles only where they fit, quick actions always, one CiP entry with its state', () => {
    const sent: MenuAction[] = []
    const base = { cip: true, send: (a: MenuAction) => void sent.push(a) }
    const plain = contextMenuTemplate({ ...base, selection: false, editable: false })
    expect(plain.some((i) => i.role)).toBe(false)
    expect(items(contextMenuTemplate({ ...base, selection: true, editable: false })).map((i) => i.role).filter(Boolean)).toEqual(['copy', 'zoomIn', 'zoomOut', 'resetZoom'])
    expect(contextMenuTemplate({ ...base, selection: false, editable: true }).map((i) => i.role).filter(Boolean)).toEqual(['cut', 'copy', 'paste', 'selectAll'])
    const cip = items(plain).filter((i) => /CiP/.test(String(i.label)))
    expect(cip).toHaveLength(1)
    expect(cip[0].checked).toBe(true)
    ;(cip[0].click as () => void)()
    items(plain).filter((i) => i.label === 'Settings').forEach((i) => (i.click as () => void)())
    expect(sent).toEqual(['togglePip', 'settings'])
  })
  it('keeps the Edit roles so copy and paste work', () => {
    const roles = items(menuTemplate({ platform: 'darwin', name: 'MCA', send: vi.fn() })).map((i) => i.role)
    expect(roles).toEqual(expect.arrayContaining(['copy', 'paste', 'selectAll', 'undo']))
  })
})
