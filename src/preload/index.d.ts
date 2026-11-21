import type { AppInfo } from '../shared/types'

export interface McaApi {
  getAppInfo: () => Promise<AppInfo>
}

declare global {
  interface Window {
    mca?: McaApi
  }
}
