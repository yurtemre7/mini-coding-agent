import { app, BrowserWindow, globalShortcut, Menu, nativeTheme, screen, shell } from 'electron'
import { menuTemplate } from './menu'
import { isExternalUrl } from './urls'
import { join } from 'path'
import { REPO_URL, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
import { createOverlay, type Overlay, type OverlayDeps, type OverlayWindow } from './overlay'
import type { Controller } from './controller'

export function getAppInfo(): AppInfo {
  return {
    name: 'mini-coding-agent',
    shortName: 'MCA',
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    license: 'MIT',
    repoUrl: REPO_URL
  }
}

let quitting = false
let mainWin: BrowserWindow | undefined
let overlayWin: BrowserWindow | undefined
let overlay: Overlay | undefined
let ipc: { controller: Controller; dispose(): void } | undefined

/** Loads the app into a window; `view` picks the floating chat's layout. */
function loadApp(w: BrowserWindow, view?: 'overlay'): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) w.loadURL(view ? `${process.env['ELECTRON_RENDERER_URL']}?view=${view}` : process.env['ELECTRON_RENDERER_URL'])
  else w.loadFile(join(__dirname, '../renderer/index.html'), view ? { query: { view } } : undefined)
}

function createOverlayWindow(o: Parameters<OverlayDeps['makeWindow']>[0]): OverlayWindow {
  const w = new BrowserWindow({
    ...o.bounds,
    minWidth: o.min.width,
    minHeight: o.min.height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    ...(o.panel && { type: 'panel' as const }), // macOS: a panel can float over full-screen apps
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff', // opaque on purpose
    title: 'MCA chat',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  w.webContents.setWindowOpenHandler((details) => {
    if (isExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // closing it (Alt+F4) only hides it; the shortcut brings it back
  w.on('close', (e) => {
    if (overlayWin === w && !quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  overlayWin = w
  loadApp(w, 'overlay')
  return w as unknown as OverlayWindow
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff', // matches --background, so the window never flashes the wrong theme while loading
    title: 'mini-coding-agent (MCA)',
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
  // Closing the window during a turn aborts it: denies pending prompts and kills child processes.
  mainWindow.on('close', () => ipc?.controller.abort())

  loadApp(mainWindow)
  mainWin = mainWindow
  mainWindow.on('closed', () => {
    if (mainWin === mainWindow) mainWin = undefined
    // the floating chat goes with the main window; on macOS the app keeps running, so it is only hidden
    if (process.platform === 'darwin') overlay?.hide()
    else overlayWin?.destroy()
  })
  return mainWindow
}

app.whenReady().then(async () => {
  app.setName('mini-coding-agent')

  overlay = createOverlay({
    platform: process.platform,
    makeWindow: createOverlayWindow,
    shortcuts: { register: (a, cb) => globalShortcut.register(a, cb), unregister: (a) => globalShortcut.unregister(a) },
    workAreas: () => [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id)].map((d) => d.workArea),
    showDock: () => void app.dock?.show()
  })
  ipc = await registerIpc(() => mainWin, getAppInfo, {
    all: () => BrowserWindow.getAllWindows().filter((w) => w === mainWin || w === overlayWin),
    overlay,
    showMain: () => {
      if (!mainWin || mainWin.isDestroyed()) return void createWindow()
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    }
  })
  createWindow()
  // native menu: its items and accelerators are sent to the window, which owns what they do
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        platform: process.platform,
        name: app.name,
        send: (action) => {
          const w = mainWin
          if (w && !w.isDestroyed()) w.webContents.send('menu:action', action)
        }
      })
    )
  )

  app.on('activate', () => {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  overlay?.dispose()
  ipc?.dispose()
})
app.on('will-quit', () => globalShortcut.unregisterAll())

