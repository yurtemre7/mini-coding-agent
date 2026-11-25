import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, Menu, Notification, type Rectangle, shell } from 'electron'
import type { IpcContract, PipMode } from '../shared/types'
import { createBatcher } from './batcher'
import { Controller } from './controller'
import { createNotifier } from './notify'
import { contextMenuTemplate } from './menu'
import { currentPip, setPip, setPipOpacity } from './pip'
import { validators } from './validate'

type Handlers = { [K in keyof IpcContract['invoke']]: (...args: IpcContract['invoke'][K]['args']) => IpcContract['invoke'][K]['result'] | Promise<IpcContract['invoke'][K]['result']> }

/** Registers every IpcContract channel (a missing or renamed one fails typecheck) and wires the Controller to the window. */
export async function registerIpc(
  getWindow: () => BrowserWindow | undefined,
  getAppInfo: Handlers['app:getInfo'],
  getMain: () => BrowserWindow | undefined = getWindow,
  makePip: (mode: PipMode, bounds: Rectangle) => BrowserWindow = () => {
    throw new Error('CiP is not available.')
  }
): Promise<{ controller: Controller; dispose(): void }> {
  // every window (main and CiP) renders the same session, so events go to all of them
  const send = <K extends keyof IpcContract['events']>(ch: K, payload: IpcContract['events'][K]) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload)
  }
  const batcher = createBatcher((batch) => send('agent:events', batch))
  const notify = createNotifier({
    desktop: (title, body) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => {
        const w = getWindow()
        if (!w || w.isDestroyed()) return
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      })
      n.show()
    },
    focused: () => !!BrowserWindow.getFocusedWindow()
  })
  const c = new Controller({
    notify,
    terminal: (e) => send('terminal:event', e),
    emit: (e, seq) => batcher.push(e, seq),
    prompt: (p) => {
      batcher.flush() // the prompt must not overtake the tool_start it belongs to
      send('prompt:request', p)
    }
  })
  await c.init() // so the first getSettings already reflects the stored keys

  const handlers: Handlers = {
    'app:getInfo': getAppInfo,
    'session:send': (text, files) => c.send(text, files),
    'session:abort': () => c.abort(),
    'session:getState': () => (batcher.flush(), c.getState()),
    'session:command': (line) => c.command(line),
    'changes:diff': (scope, path) => c.changeDiff(scope, path),
    'changes:revert': (scope, path) => c.changeRevert(scope, path),
    'workspace:select': async () => {
      const w = getWindow()
      const opts = { properties: ['openDirectory' as const] }
      const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts))
      if (!r.canceled && r.filePaths[0]) await c.selectWorkspace(r.filePaths[0])
    },
    'workspace:recent': () => c.recent(),
    'workspace:newest': () => c.newest(),
    'workspace:open': (p) => c.openRecent(p),
    'workspace:forget': (p) => c.forgetRecent(p),
    'workspace:reorder': (o) => c.reorderRecent(o),
    'workspace:overview': () => c.overview(),
    'session:list': () => c.chats(),
    'session:open': (id) => c.openChat(id),
    'session:new': () => c.newChat(),
    'session:delete': (id) => c.deleteChat(id),
    'session:rename': (id, title) => c.renameChat(id, title),
    'session:export': async (id) => {
      const { title, markdown } = c.exportChat(id)
      const w = getWindow()
      const opts = { defaultPath: `${title.replace(/[^\w .-]+/g, '').trim().slice(0, 60) || 'chat'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] }
      const r = await (w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts))
      if (r.canceled || !r.filePath) return null
      await writeFile(r.filePath, markdown, 'utf8')
      return r.filePath
    },
    'workspace:reveal': () => {
      const ws = c.getState().workspace
      if (ws) shell.showItemInFolder(ws)
    },
    'workspace:files': () => c.workspaceFiles(),
    'git:status': () => c.gitStatus(),
    'git:diff': (p, staged) => c.gitDiff(p, staged),
    'git:stage': (ps, stage) => c.gitStage(ps, stage),
    'git:commit': (m) => c.gitCommit(m),
    'git:push': () => c.gitPush(),
    'git:branches': () => c.gitBranches(),
    'git:switch': (n, create) => c.gitSwitch(n, create),
    'terminal:run': (cmd) => c.terminalRun(cmd),
    'terminal:kill': () => c.terminalKill(),
    'settings:get': () => c.getSettings(),
    'settings:setKey': (p, key) => c.setKey(p, key),
    'settings:update': (patch) => c.update(patch),
    'settings:models': (p) => c.models(p),
    'settings:addFolderRoot': async () => {
      const w = getWindow()
      const opts = { title: 'Allow a folder for newest folders', properties: ['openDirectory' as const] }
      const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts))
      return !r.canceled && r.filePaths[0] ? c.addFolderRoot(r.filePaths[0]) : c.getSettings()
    },
    'settings:removeFolderRoot': (p) => c.removeFolderRoot(p),
    'prompt:answer': (id, d) => c.answer(id, d),
    'commands:list': () => c.commandList(),
    'skills:list': () => c.skillList(),
    'skills:set': (name, enabled) => c.setSkill(name, enabled),
    'window:contextMenu': (ctx) => {
      const w = getWindow()
      if (!w || w.isDestroyed()) return
      const send = (a: Parameters<Parameters<typeof contextMenuTemplate>[0]['send']>[0]) => w.webContents.send('menu:action', a)
      Menu.buildFromTemplate(contextMenuTemplate({ ...ctx, cip: !!currentPip(), send })).popup({ window: w })
    },
    'window:pip': (mode, opacity) => {
      setPipOpacity(opacity)
      const m = getMain()
      if (m && !m.isDestroyed()) setPip(m, mode, makePip)
    },
    'window:pipOpacity': (opacity) => setPipOpacity(opacity),
    'window:cipBounds': (b) => currentPip()?.win.setBounds(b)
  }
  for (const ch of Object.keys(handlers) as (keyof Handlers)[]) {
    ipcMain.handle(ch, (_e, ...args: unknown[]) => (handlers[ch] as (...a: unknown[]) => unknown)(...validators[ch](args)))
  }
  void c.openLast().catch(() => {}) // not awaited: a trust prompt must not block startup; the renderer reads the result from getState
  return {
    controller: c,
    dispose() {
      c.dispose()
      batcher.dispose()
      for (const ch of Object.keys(handlers)) ipcMain.removeHandler(ch)
    }
  }
}
