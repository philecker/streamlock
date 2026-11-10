// Browser-only stand-in for the Electron main process, so the real React
// screens can be clicked through in a web page. Everything is in memory.

import type { AppState, PinMode, Result, RunItem, Settings } from '@shared/types'
import { SERVICES, getService, type ServiceId } from '@shared/services'
import type { StreamLockApi } from '../src/preload/api'
import { activePeriod, isPending, nextChangeAt, nextPeriod } from '../src/main/schedule'

export interface SimEvent {
  kind: 'notify' | 'window' | 'window-closed' | 'clipboard' | 'open-settings'
  title?: string
  body?: string
  serviceId?: ServiceId
  pin?: string
}

const ok: Result = { ok: true, value: undefined }
const fail = (error: string): Result => ({ ok: false, error })

function mmyyOf(period: string): string {
  const [y, m] = period.split('-')
  return `${m}${(y ?? '').slice(2)}`
}

/** Stand-in for the HMAC "secret" mode: stable per period, not guessable from the date. */
function secretOf(period: string): string {
  let h = 2166136261
  for (const c of `demo-secret:${period}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return String((h >>> 0) % 10000).padStart(4, '0')
}

function weak(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Use exactly 4 digits.'
  if (/^(\d)\1{3}$/.test(pin)) return 'Avoid repeating one digit.'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Avoid straight runs like 1234.'
  if (/^(19|20)\d\d$/.test(pin)) return 'Avoid years; they are easy to guess.'
  return null
}

const SAMPLE_LOGINS: ServiceId[] = ['netflix', 'disney', 'hulu', 'max', 'peacock', 'prime', 'plex']

class Sim {
  now = new Date(2026, 9, 24, 22, 40)
  vault: AppState['vault'] = 'unlocked'
  settings!: Settings
  logins: { serviceId: ServiceId; email: string; profiles: string; settingsUrl?: string }[] = []
  customPin?: string
  run?: AppState['run']
  hasRecovery = true
  recoveryKey?: string
  private demoKey = 'K7QM-2XRB-9TFD-H4NW-6PJC-YV3G'
  private listeners = new Set<(s: AppState) => void>()
  private eventListeners = new Set<(e: SimEvent) => void>()
  private dueNoticed: string | undefined

  constructor() {
    this.reset('sample')
  }

  reset(kind: 'sample' | 'fresh'): void {
    this.now = new Date(2026, 9, 24, 22, 40)
    this.run = undefined
    this.customPin = undefined
    this.dueNoticed = undefined
    this.settings = {
      pinMode: 'mmyy',
      autoLockMinutes: 5,
      unlockMinutes: 60,
      changeHour: 9,
      notifyDayBefore: true,
      primePinLength: 4,
      launchAtLogin: true,
      touchIdEnabled: kind === 'sample',
      services: {}
    }
    if (kind === 'fresh') {
      this.vault = 'missing'
      this.logins = []
    } else {
      this.vault = 'unlocked'
      this.logins = SAMPLE_LOGINS.map((serviceId) => ({
        serviceId,
        email: 'you@example.com',
        profiles: serviceId === 'hulu' || serviceId === 'prime' ? '' : 'Dad, Mom'
      }))
      for (const id of SAMPLE_LOGINS) {
        if (id === 'max') continue
        this.settings.services[id] = { lastAppliedPeriod: '2026-10', lastAppliedAt: new Date(2026, 9, 1, 9, 4).toISOString() }
      }
    }
    this.emit()
  }

  // ---- derived ----

  period(): string {
    return activePeriod(this.now, this.settings.changeHour)
  }

  pinFor(period: string): string | undefined {
    switch (this.settings.pinMode) {
      case 'mmyy':
        return mmyyOf(period)
      case 'secret':
        return secretOf(period)
      case 'custom':
        return this.customPin
    }
  }

  pending(): ServiceId[] {
    return this.logins
      .map((l) => l.serviceId)
      .filter((id) => isPending(this.settings.services[id]?.lastAppliedPeriod, this.now, this.settings.changeHour))
  }

  state(): AppState {
    const unlocked = this.vault === 'unlocked'
    const period = this.period()
    const value = this.pinFor(period)
    const pending = unlocked ? this.pending() : this.logins.length ? this.pending() : []
    return {
      vault: this.vault,
      touchIdAvailable: true,
      settings: structuredClone(this.settings),
      pin:
        unlocked && value
          ? {
              value,
              mode: this.settings.pinMode,
              period,
              nextChangeAt: nextChangeAt(this.now, this.settings.changeHour).toISOString(),
              nextValue: this.settings.pinMode === 'secret' ? undefined : this.pinFor(nextPeriod(period))
            }
          : undefined,
      logins: unlocked ? structuredClone(this.logins) : [],
      run: this.run ? structuredClone(this.run) : undefined,
      pendingServices: pending,
      dueNow: pending.length > 0,
      hasRecoveryKey: this.hasRecovery,
      recoveryKey: unlocked ? this.recoveryKey : undefined
    }
  }

  // ---- plumbing ----

  subscribe(cb: (s: AppState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onEvent(cb: (e: SimEvent) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  emit(): void {
    const s = this.state()
    for (const l of this.listeners) l(s)
  }

  event(e: SimEvent): void {
    for (const l of this.eventListeners) l(e)
  }

  private pause = () => new Promise((r) => setTimeout(r, 250))

  // ---- simulated clock ----

  /** Jump to the next change moment and let the scheduler react, as the app's 30 s tick would. */
  jumpToNextChange(): void {
    const change = nextChangeAt(this.now, this.settings.changeHour)
    if (this.settings.notifyDayBefore) {
      this.event({ kind: 'notify', title: 'PIN changes tomorrow', body: 'StreamLock will ask you to apply the new PIN in the morning.' })
    }
    this.now = new Date(change.getTime() + 2 * 60_000)
    if (this.run) this.cancelRun()
    this.tick()
    this.emit()
  }

  tick(): void {
    const p = this.period()
    if (this.pending().length > 0 && this.dueNoticed !== p) {
      this.dueNoticed = p
      this.event({
        kind: 'notify',
        title: 'New streaming PIN is ready',
        body: this.vault === 'unlocked' ? 'Click the menu bar icon and choose Apply.' : 'Unlock StreamLock to apply it.'
      })
    }
  }

  // ---- actions ----

  private markAllPending(): void {
    const [y, m] = this.period().split('-').map(Number) as [number, number]
    const prev = new Date(y, m - 2, 1)
    const stale = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
    for (const id of Object.keys(this.settings.services) as ServiceId[]) {
      const rec = this.settings.services[id]
      if (rec?.lastAppliedPeriod) rec.lastAppliedPeriod = stale
    }
  }

  private advance(): void {
    const next = this.run?.items.find((i) => i.status === 'queued')
    if (!next || !this.run) {
      this.run = undefined
      this.event({ kind: 'window-closed' })
      return
    }
    next.status = 'needs-you'
    const svc = getService(next.serviceId)
    const pin = next.serviceId === 'prime' && this.settings.primePinLength === 5 ? this.run.pin.padStart(5, '0') : this.run.pin
    this.event({ kind: 'window', serviceId: next.serviceId, pin, title: svc?.name })
    this.event({ kind: 'clipboard', pin })
  }

  private startRun(ids: ServiceId[]): Result {
    if (this.run) return fail('Already applying.')
    const pin = this.pinFor(this.period())
    if (!pin) return fail('Set a PIN first.')
    if (!ids.length) return fail('Nothing to apply.')
    this.run = {
      period: this.period(),
      pin,
      startedAt: this.now.toISOString(),
      items: ids.map((serviceId): RunItem => ({ serviceId, status: 'queued' }))
    }
    this.advance()
    this.emit()
    return ok
  }

  api: StreamLockApi = {
    getState: async () => this.state(),
    onState: (cb) => this.subscribe(cb),
    setup: async (pw, touch) => {
      await this.pause()
      if (pw.length < 10) return fail('Use at least 10 characters.')
      this.hasRecovery = true
      this.recoveryKey = this.demoKey
      this.vault = 'unlocked'
      this.settings.touchIdEnabled = touch
      this.emit()
      return ok
    },
    unlock: async (pw) => {
      await this.pause()
      if (!pw) return fail('That password is not right.')
      this.vault = 'unlocked'
      this.tick()
      this.emit()
      return ok
    },
    unlockTouchId: async () => {
      await this.pause()
      this.vault = 'unlocked'
      this.tick()
      this.emit()
      return ok
    },
    lock: async () => {
      if (this.run) this.cancelRun()
      this.vault = 'locked'
      this.emit()
    },
    changePassword: async (_a, b) => (b.length < 10 ? fail('Use at least 10 characters.') : ok),
    copyRecoveryKey: async () => {
      if (!this.recoveryKey) return fail('There is no recovery key to copy.')
      this.event({ kind: 'clipboard', pin: this.recoveryKey })
      return ok
    },
    ackRecoveryKey: async () => {
      this.recoveryKey = undefined
      this.emit()
    },
    createRecoveryKey: async () => {
      this.hasRecovery = true
      this.recoveryKey = 'R2D9-6MXQ-T8KB-3HVN-PZ4C-JW7F'
      this.demoKey = this.recoveryKey
      this.emit()
      return ok
    },
    resetWithRecoveryKey: async (key, pw) => {
      await this.pause()
      const norm = (k: string) => k.toUpperCase().replace(/[\s-]/g, '')
      if (norm(key).length !== 24) return fail('A recovery key has 24 letters and numbers.')
      if (norm(key) !== norm(this.demoKey)) return fail(`That recovery key is not right. (Preview key: ${this.demoKey})`)
      if (pw.length < 10) return fail('Use at least 10 characters.')
      this.vault = 'unlocked'
      this.emit()
      return ok
    },
    resetWithTouchId: async (pw) => {
      await this.pause()
      if (!this.settings.touchIdEnabled) return fail('Touch ID unlock is not turned on.')
      if (pw.length < 10) return fail('Use at least 10 characters.')
      this.vault = 'unlocked'
      this.emit()
      return ok
    },
    eraseVault: async () => {
      await this.pause()
      if (this.run) this.cancelRun()
      this.vault = 'missing'
      this.logins = []
      this.hasRecovery = false
      this.settings.touchIdEnabled = false
      if (this.settings.pinMode === 'custom') this.settings.pinMode = 'mmyy'
      this.emit()
      return ok
    },
    setTouchId: async (on) => {
      this.settings.touchIdEnabled = on
      this.emit()
      return ok
    },
    setPinMode: async (mode: PinMode, custom?: string) => {
      if (mode === 'custom') {
        const pin = custom ?? this.customPin
        if (!pin) return fail('Enter a 4-digit PIN.')
        const w = weak(pin)
        if (w) return fail(w)
        this.customPin = pin
      }
      const before = this.pinFor(this.period())
      this.settings.pinMode = mode
      if (this.pinFor(this.period()) !== before) this.markAllPending()
      if (this.run) this.cancelRun()
      this.emit()
      return ok
    },
    copyPin: async () => {
      const pin = this.pinFor(this.period())
      if (!pin) return fail('No PIN yet.')
      this.event({ kind: 'clipboard', pin })
      return ok
    },
    saveLogin: async (input) => {
      if (!input.email.trim()) return fail('Enter the email or username for this account.')
      const existing = this.logins.find((l) => l.serviceId === input.serviceId)
      if (!existing && !input.password) return fail('Enter the password.')
      const svc = getService(input.serviceId)
      let settingsUrl: string | undefined
      if (input.settingsUrl.trim() && svc) {
        let u: URL
        try {
          u = new URL(/^https?:\/\//i.test(input.settingsUrl.trim()) ? input.settingsUrl.trim() : `https://${input.settingsUrl.trim()}`)
        } catch {
          return fail('PIN page: That is not a web address.')
        }
        if (u.protocol !== 'https:' || !svc.allowedHosts.includes(u.hostname)) return fail(`PIN page: Use an address on ${svc.allowedHosts.join(', ')}.`)
        settingsUrl = u.toString() === svc.settingsUrl ? undefined : u.toString()
      }
      this.logins = this.logins.filter((l) => l.serviceId !== input.serviceId)
      this.logins.push({ serviceId: input.serviceId, email: input.email.trim(), profiles: input.profiles.trim(), settingsUrl })
      this.emit()
      return ok
    },
    deleteLogin: async (id) => {
      this.logins = this.logins.filter((l) => l.serviceId !== id)
      delete this.settings.services[id]
      this.emit()
      return ok
    },
    apply: async (onlyPending) => {
      const order = SERVICES.map((s) => s.id)
      let ids = this.logins.map((l) => l.serviceId).sort((a, b) => order.indexOf(a) - order.indexOf(b))
      if (onlyPending) ids = ids.filter((id) => this.pending().includes(id))
      return this.startRun(ids)
    },
    applyOne: async (id) => {
      if (!this.logins.some((l) => l.serviceId === id)) return fail('Add a login for this service first.')
      return this.startRun([id])
    },
    goToSettings: async (id) => {
      this.event({ kind: 'window', serviceId: id, pin: this.run?.pin, title: getService(id)?.name })
    },
    markDone: async (id) => {
      const item = this.run?.items.find((i) => i.serviceId === id)
      if (!item || item.status !== 'needs-you' || !this.run) return
      item.status = 'done'
      this.settings.services[id] = { lastAppliedPeriod: this.run.period, lastAppliedAt: this.now.toISOString() }
      this.advance()
      this.emit()
    },
    skip: async (id) => {
      const item = this.run?.items.find((i) => i.serviceId === id)
      if (!item || item.status !== 'needs-you') return
      item.status = 'skipped'
      this.advance()
      this.emit()
    },
    focus: async (id) => {
      this.event({ kind: 'window', serviceId: id, pin: this.run?.pin, title: getService(id)?.name })
    },
    cancelRun: async () => this.cancelRun(),
    updatePrefs: async (patch) => {
      Object.assign(this.settings, patch)
      this.emit()
      return ok
    },
    openSettings: async () => this.event({ kind: 'open-settings' }),
    quit: async () => this.event({ kind: 'notify', title: 'Quit is disabled in the preview', body: 'In the real app this quits StreamLock.' })
  }

  cancelRun(): void {
    this.run = undefined
    this.event({ kind: 'window-closed' })
    this.emit()
  }
}

export const sim = new Sim()
;(window as unknown as { streamlock: StreamLockApi }).streamlock = sim.api
