import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type McaApi } from '../shared/types'

const mcaApi: McaApi = {
  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, cb) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const h = (_e: unknown, payload: any) => cb(payload)
    ipcRenderer.on(channel, h)
    return () => void ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('mca', mcaApi)
