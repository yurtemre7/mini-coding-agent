import { app, BrowserWindow, Menu, nativeTheme, type Rectangle, shell } from 'electron'
import { menuTemplate } from './menu'
import { isExternalUrl } from './urls'
import { join } from 'path'
import { REPO_URL, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
import { currentPip, initPipBounds } from './pip'
import type { PipMode } from '../shared/types'
import type { Controller } from './controller'

export function getAppInfo(): AppInfo {
  return {
    name: 'mid-coding-agent',
    shortName: 'MCA',
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    license: 'MIT',
    repoUrl: REPO_URL
  }
}

let ipc: { controller: Controller; dispose(): void } | undefined
let main: BrowserWindow | undefined

/** The window that should get dialogs and menu actions: the focused one, else the open PiP window, else the main window. */
const target = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? currentPip()?.win ?? main

/** The main window, or (with `pip`) a frameless always-on-top chat window that loads the renderer in PiP mode. */
function createWindow(pip?: { mode: PipMode; bounds: Rectangle }): BrowserWindow {
  const mainWindow = new BrowserWindow({
    ...(pip ? { ...pip.bounds, minWidth: 280, minHeight: 240, frame: false, resizable: true, thickFrame: true, maximizable: false, fullscreenable: false, skipTaskbar: false } : { width: 1120, height: 760, minWidth: 800, minHeight: 560 }),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff', // matches --background, so the window never flashes the wrong theme while loading
    title: 'mid-coding-agent (MCA)',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Links (Markdown, target=_blank) go to the system browser; the app window itself never navigates away.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  if (!pip) {
    // Closing the main window during a turn aborts it: denies pending prompts and kills child processes. It also closes the PiP window.
    mainWindow.on('close', () => {
      ipc?.controller.abort()
      currentPip()?.win.destroy()
    })
  }

  const query = pip ? { pip: pip.mode } : undefined
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (query ? `?pip=${query.pip}` : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }

  return mainWindow
}

app.whenReady().then(async () => {
  app.setName('mid-coding-agent')

  initPipBounds(join(app.getPath('userData'), 'cip-bounds.json'))
  ipc = await registerIpc(target, getAppInfo, () => main, (mode, bounds) => createWindow({ mode, bounds }))
  main = createWindow()
  // native menu: its items and accelerators are sent to the window, which owns what they do
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        platform: process.platform,
        name: app.name,
        send: (action) => {
          const w = target()
          if (w && !w.isDestroyed()) w.webContents.send('menu:action', action)
        }
      })
    )
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      main = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => ipc?.dispose())

