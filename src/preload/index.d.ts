import type { McaApi } from '../shared/types'

declare global {
  interface Window {
    mca?: McaApi
  }
}
