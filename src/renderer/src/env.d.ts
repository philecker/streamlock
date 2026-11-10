import type { StreamLockApi } from '../../preload/api'

declare global {
  interface Window {
    streamlock: StreamLockApi
  }
}

export {}
