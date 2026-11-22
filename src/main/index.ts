import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { isExternalUrl } from './urls'
import { join } from 'path'
import { REPO_URL, type AppInfo } from '../shared/types'
import { registerIpc } from './ipc'
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

let ipc: { controller: Controller; dispose(): void } | undefined

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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  app.setName('mini-coding-agent')

  ipc = await registerIpc(() => BrowserWindow.getAllWindows()[0], getAppInfo)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => ipc?.dispose())

