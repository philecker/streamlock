import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StreamLockApi } from './api'

// Exposes a small, typed API. The renderer never sees ipcRenderer itself.
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: StreamLockApi = {
  getState: () => invoke('state'),
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
  setup: (pw, touchId) => invoke('vault:setup', pw, touchId),
  unlock: (pw) => invoke('vault:unlock', pw),
  unlockTouchId: () => invoke('vault:unlockTouchId'),
  lock: () => invoke('vault:lock'),
  changePassword: (a, b) => invoke('vault:changePassword', a, b),
  setTouchId: (on) => invoke('vault:setTouchId', on),
  ackRecoveryKey: () => invoke('vault:ackRecoveryKey'),
  copyRecoveryKey: () => invoke('vault:copyRecoveryKey'),
  createRecoveryKey: () => invoke('vault:createRecoveryKey'),
  resetWithRecoveryKey: (key, pw) => invoke('vault:resetWithRecoveryKey', key, pw),
  resetWithTouchId: (pw) => invoke('vault:resetWithTouchId', pw),
  eraseVault: () => invoke('vault:erase'),
  setPinMode: (mode, custom) => invoke('pin:setMode', mode, custom),
  copyPin: () => invoke('pin:copy'),
  saveLogin: (input) => invoke('login:save', input),
  deleteLogin: (id) => invoke('login:delete', id),
  apply: (onlyPending) => invoke('run:apply', onlyPending),
  applyOne: (id) => invoke('run:applyOne', id),
  goToSettings: (id) => invoke('run:goToSettings', id),
  markDone: (id) => invoke('run:done', id),
  skip: (id) => invoke('run:skip', id),
  focus: (id) => invoke('run:focus', id),
  cancelRun: () => invoke('run:cancel'),
  updatePrefs: (patch) => invoke('prefs:update', patch),
  openSettings: () => invoke('app:openSettings'),
  quit: () => invoke('app:quit')
}

contextBridge.exposeInMainWorld('streamlock', api)
