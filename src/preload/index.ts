import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type IpcContract, type McaApi } from '../shared/types'

const mcaApi: McaApi = {
  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  on: <K extends keyof IpcContract['events']>(channel: K, cb: (payload: IpcContract['events'][K]) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const h = (_e: unknown, payload: IpcContract['events'][K]) => cb(payload)
    ipcRenderer.on(channel, h)
    return () => void ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('mca', mcaApi)
