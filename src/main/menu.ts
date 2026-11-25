import type { MenuItemConstructorOptions } from 'electron'
import type { ContextMenuContext, MenuAction } from '../shared/types'

/** The native menu: standard roles plus the app's own actions with their shortcuts. Pure, so it is testable without Electron running. */
export function menuTemplate(o: { platform: NodeJS.Platform; name: string; send(action: MenuAction): void }): MenuItemConstructorOptions[] {
  const mac = o.platform === 'darwin'
  const act = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => o.send(action) })
  const settings = act(mac ? 'Settings…' : 'Settings', 'settings', 'CmdOrCtrl+,')
  return [
    ...(mac
      ? [{ label: o.name, submenu: [{ role: 'about' }, { type: 'separator' }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [act('New Chat', 'newChat', 'CmdOrCtrl+N'), act('Open Workspace…', 'openWorkspace', 'CmdOrCtrl+O'), { type: 'separator' }, ...(mac ? [] : [settings, { type: 'separator' } as MenuItemConstructorOptions]), { role: mac ? 'close' : 'quit' }]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Chat',
      submenu: [act('Focus Message Field', 'focusPrompt', 'CmdOrCtrl+L'), act('Stop the Agent', 'stop', 'CmdOrCtrl+.')]
    },
    {
      label: 'View',
      submenu: [
        act('Toggle Sidebar', 'toggleSidebar', 'CmdOrCtrl+B'),
        act('Toggle Tools Panel', 'togglePanel', 'CmdOrCtrl+J'),
        act('CiP (Chat in Picture)', 'togglePip', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        act('Show Changes', 'tabChanges', 'CmdOrCtrl+1'),
        act('Show Git', 'tabGit', 'CmdOrCtrl+2'),
        act('Show Terminal', 'tabTerminal', 'CmdOrCtrl+3'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
}

/** The right-click menu: edit commands that fit the spot, then quick actions and view settings. Pure, so it is testable without Electron running. */
export function contextMenuTemplate(o: ContextMenuContext & { cip: boolean; send(action: MenuAction): void }): MenuItemConstructorOptions[] {
  const act = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => o.send(action) })
  const edit: MenuItemConstructorOptions[] = o.editable
    ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    : o.selection
      ? [{ role: 'copy' }]
      : []
  return [
    ...(edit.length ? [...edit, { type: 'separator' } as MenuItemConstructorOptions] : []),
    { label: 'CiP (Chat in Picture)', type: 'checkbox', checked: o.cip, accelerator: 'CmdOrCtrl+Shift+P', click: () => o.send('togglePip') },
    act('New Chat', 'newChat', 'CmdOrCtrl+N'),
    act('Open Workspace…', 'openWorkspace', 'CmdOrCtrl+O'),
    act('Focus Message Field', 'focusPrompt', 'CmdOrCtrl+L'),
    act('Stop the Agent', 'stop', 'CmdOrCtrl+.'),
    { type: 'separator' },
    act('Toggle Sidebar', 'toggleSidebar', 'CmdOrCtrl+B'),
    act('Toggle Tools Panel', 'togglePanel', 'CmdOrCtrl+J'),
    { label: 'Show', submenu: [act('Changes', 'tabChanges', 'CmdOrCtrl+1'), act('Git', 'tabGit', 'CmdOrCtrl+2'), act('Terminal', 'tabTerminal', 'CmdOrCtrl+3')] },
    { label: 'Zoom', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { type: 'separator' },
    act('Settings', 'settings', 'CmdOrCtrl+,')
  ]
}
