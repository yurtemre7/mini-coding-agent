import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcContract } from '../shared/types'
import { createBatcher } from './batcher'
import { Controller } from './controller'

type Handlers = { [K in keyof IpcContract['invoke']]: (...args: IpcContract['invoke'][K]['args']) => IpcContract['invoke'][K]['result'] | Promise<IpcContract['invoke'][K]['result']> }

/** Registers every IpcContract channel (a missing or renamed one fails typecheck) and wires the Controller to the window. */
export function registerIpc(getWindow: () => BrowserWindow | undefined, getAppInfo: Handlers['app:getInfo']): Controller {
  const send = <K extends keyof IpcContract['events']>(ch: K, payload: IpcContract['events'][K]) => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload)
  }
  const batcher = createBatcher((events) => send('agent:events', events))
  const c = new Controller({
    emit: (e) => batcher.push(e),
    prompt: (p) => {
      batcher.flush() // the prompt must not overtake the tool_start it belongs to
      send('prompt:request', p)
    }
  })
  void c.init()

  const handlers: Handlers = {
    'app:getInfo': getAppInfo,
    'session:send': (text) => c.send(text),
    'session:abort': () => c.abort(),
    'session:getState': () => (batcher.flush(), c.getState()),
    'session:command': (line) => c.command(line),
    'workspace:select': async () => {
      const w = getWindow()
      const opts = { properties: ['openDirectory' as const] }
      const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts))
      if (!r.canceled && r.filePaths[0]) await c.selectWorkspace(r.filePaths[0])
      return c.getState()
    },
    'settings:get': () => c.getSettings(),
    'settings:setKey': (p, key) => c.setKey(p, key),
    'settings:update': (patch) => c.update(patch),
    'prompt:answer': (id, d) => c.answer(id, d)
  }
  for (const ch of Object.keys(handlers) as (keyof Handlers)[]) {
    ipcMain.handle(ch, (_e, ...args: unknown[]) => (handlers[ch] as (...a: unknown[]) => unknown)(...args))
  }
  return c
}
