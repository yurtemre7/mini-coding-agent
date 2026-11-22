import type { MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/types'

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
