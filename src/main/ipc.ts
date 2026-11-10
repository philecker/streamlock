// IPC surface. Every channel checks the sender is our own UI and validates its
// arguments; the renderer is treated as untrusted input.

import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { LoginInput, PinMode, Result } from '@shared/types'
import { isServiceId } from '@shared/services'
import type { Controller } from './controller'
import { isOwnUi, openSettings } from './windows'

const str = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length <= max
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const BAD: Result = { ok: false, error: 'Invalid request.' }

type Handler = (...args: unknown[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isOwnUi(e.senderFrame?.url)) return BAD
    return fn(...args)
  })
}

export function registerIpc(c: Controller): void {
  handle('state', () => c.state())

  handle('vault:setup', (pw, touch) => (str(pw) && bool(touch) ? c.setup(pw, touch) : BAD))
  handle('vault:unlock', (pw) => (str(pw) ? c.unlockWithPassword(pw) : BAD))
  handle('vault:unlockTouchId', () => c.unlockWithTouchId())
  handle('vault:lock', () => c.lock())
  handle('vault:changePassword', (a, b) => (str(a) && str(b) ? c.changePassword(a, b) : BAD))
  handle('vault:ackRecoveryKey', () => c.ackRecoveryKey())
  handle('vault:copyRecoveryKey', () => c.copyRecoveryKey())
  handle('vault:createRecoveryKey', () => c.createRecoveryKey())
  handle('vault:resetWithRecoveryKey', (key, pw) => (str(key, 200) && str(pw) ? c.resetWithRecoveryKey(key, pw) : BAD))
  handle('vault:resetWithTouchId', (pw) => (str(pw) ? c.resetWithTouchId(pw) : BAD))
  handle('vault:erase', () => c.eraseVault())
  handle('vault:setTouchId', (on) => (bool(on) ? c.setTouchId(on) : BAD))

  handle('pin:setMode', (mode, custom) => {
    const modes: PinMode[] = ['mmyy', 'secret', 'custom']
    if (!modes.includes(mode as PinMode)) return BAD
    if (custom !== undefined && !str(custom, 8)) return BAD
    return c.setPinMode(mode as PinMode, custom as string | undefined)
  })
  handle('pin:copy', () => c.copyPin())

  handle('login:save', (raw) => {
    const r = raw as Partial<LoginInput> | null
    if (!r || !isServiceId(r.serviceId) || !str(r.email, 320) || !str(r.password, 1024) || !str(r.profiles, 200)) return BAD
    const settingsUrl = r.settingsUrl ?? ''
    if (!str(settingsUrl, 2048)) return BAD
    return c.saveLogin({ serviceId: r.serviceId, email: r.email, password: r.password, profiles: r.profiles, settingsUrl })
  })
  handle('login:delete', (id) => (isServiceId(id) ? c.deleteLogin(id) : BAD))

  handle('run:apply', (onlyPending) => (bool(onlyPending) ? c.applyAll(onlyPending) : BAD))
  handle('run:applyOne', (id) => (isServiceId(id) ? c.applyOne(id) : BAD))
  handle('run:goToSettings', (id) => (isServiceId(id) ? c.goToSettings(id) : BAD))
  handle('run:done', (id) => (isServiceId(id) ? c.markDone(id) : BAD))
  handle('run:skip', (id) => (isServiceId(id) ? c.skip(id) : BAD))
  handle('run:focus', (id) => (isServiceId(id) ? c.focusService(id) : BAD))
  handle('run:cancel', () => c.cancelRun())

  handle('prefs:update', (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const patch: Parameters<Controller['updatePrefs']>[0] = {}
    if (r.autoLockMinutes !== undefined) {
      if (typeof r.autoLockMinutes !== 'number') return BAD
      patch.autoLockMinutes = r.autoLockMinutes
    }
    if (r.unlockMinutes !== undefined) {
      if (typeof r.unlockMinutes !== 'number') return BAD
      patch.unlockMinutes = r.unlockMinutes
    }
    if (r.changeHour !== undefined) {
      if (typeof r.changeHour !== 'number') return BAD
      patch.changeHour = r.changeHour
    }
    if (r.notifyDayBefore !== undefined) {
      if (!bool(r.notifyDayBefore)) return BAD
      patch.notifyDayBefore = r.notifyDayBefore
    }
    if (r.launchAtLogin !== undefined) {
      if (!bool(r.launchAtLogin)) return BAD
      patch.launchAtLogin = r.launchAtLogin
    }
    if (r.primePinLength !== undefined) {
      if (r.primePinLength !== 4 && r.primePinLength !== 5) return BAD
      patch.primePinLength = r.primePinLength
    }
    return c.updatePrefs(patch)
  })

  handle('app:openSettings', () => void openSettings())
  handle('app:quit', () => app.quit())
}
