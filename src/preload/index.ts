import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo } from '../shared/types'

const mcaApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo')
}

contextBridge.exposeInMainWorld('mca', mcaApi)
