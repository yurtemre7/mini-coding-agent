import { writeFile } from 'node:fs/promises'
import { type BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import type { IpcContract } from '../shared/types'
import { createBatcher } from './batcher'
import { Controller } from './controller'
import { createNotifier } from './notify'
import { validators } from './validate'

type Handlers = { [K in keyof IpcContract['invoke']]: (...args: IpcContract['invoke'][K]['args']) => IpcContract['invoke'][K]['result'] | Promise<IpcContract['invoke'][K]['result']> }

/** Registers every IpcContract channel (a missing or renamed one fails typecheck) and wires the Controller to the window. */
export async function registerIpc(getWindow: () => BrowserWindow | undefined, getAppInfo: Handlers['app:getInfo']): Promise<{ controller: Controller; dispose(): void }> {
  const send = <K extends keyof IpcContract['events']>(ch: K, payload: IpcContract['events'][K]) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload)
  }
  const batcher = createBatcher((batch) => send('agent:events', batch))
  const notify = createNotifier({
    desktop: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
    focused: () => !!getWindow()?.isFocused()
  })
  const c = new Controller({
    notify,
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
    'workspace:open': (p) => c.openRecent(p),
    'workspace:forget': (p) => c.forgetRecent(p),
    'session:list': () => c.chats(),
    'session:open': (id) => c.openChat(id),
    'session:new': () => c.newChat(),
    'session:delete': (id) => c.deleteChat(id),
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
    'settings:get': () => c.getSettings(),
    'settings:setKey': (p, key) => c.setKey(p, key),
    'settings:update': (patch) => c.update(patch),
    'settings:models': (p) => c.models(p),
    'prompt:answer': (id, d) => c.answer(id, d),
    'commands:list': () => c.commandList()
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
