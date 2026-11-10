// App logic with no knowledge of windows or IPC. Platform hooks (Touch ID,
// notifications, idle time) are injected so this stays readable and testable.

import { EventEmitter } from 'node:events'
import type { AppState, LoginInput, LoginSummary, PinMode, Result, Settings } from '@shared/types'
import { SERVICES, getService, isServiceId, type ServiceId } from '@shared/services'
import { Vault, VaultError, passwordProblem } from './vault'
import { SettingsStore } from './settings'
import { adaptPin, isValidPinFormat, pinFor, weakPinReason, type PinSources } from './pin'
import { activePeriod, isPending, nextChangeAt, nextPeriod, periodOf, shouldNoticeDayBefore } from './schedule'
import type { Runner, RunCredentials } from './automation/runner'
import { checkSettingsUrl } from './automation/autofill'

export interface Platform {
  touchIdAvailable(): boolean
  promptTouchId(reason: string): Promise<boolean>
  notify(title: string, body: string): void
  idleSeconds(): number
  setOpenAtLogin(enabled: boolean): void
  now(): Date
}

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): Result<never> => ({ ok: false, error })

/** Turns thrown errors into user-facing Results; unexpected ones are logged, not shown raw. */
async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    if (e instanceof VaultError) return fail(e.message)
    if (e instanceof UserError) return fail(e.message)
    console.error('[streamlock]', e)
    return fail('Something went wrong. Check the logs for details.')
  }
}

class UserError extends Error {}

export class Controller extends EventEmitter<{ changed: [] }> {
  private status: AppState['vault'] = 'missing'
  private dueNoticePeriod: string | undefined
  private unlockedAt = 0
  private hasRecovery = false
  /** A recovery key waiting to be shown once, until the user confirms they saved it. */
  private recoveryKeyToShow: string | undefined

  constructor(
    private readonly vault: Vault,
    private readonly settings: SettingsStore,
    private readonly runner: Runner,
    private readonly platform: Platform
  ) {
    super()
    runner.on('changed', () => this.emit('changed'))
    runner.on('applied', (id, period) => {
      void this.settings
        .update((s) => {
          s.services[id] = { lastAppliedPeriod: period, lastAppliedAt: this.platform.now().toISOString() }
        })
        .then(() => this.emit('changed'))
    })
  }

  async init(): Promise<void> {
    await this.settings.load()
    this.status = (await this.vault.exists()) ? 'locked' : 'missing'
    // A keychain wrap without the setting (or vice versa) means a crash mid-change; trust the file.
    this.hasRecovery = await this.vault.hasRecoveryKey()
    const hasKeychain = await this.vault.hasKeychainUnlock()
    if (hasKeychain !== this.settings.get().touchIdEnabled) {
      await this.settings.update((s) => (s.touchIdEnabled = hasKeychain))
    }
  }

  // ---------- state ----------

  state(): AppState {
    const s = this.settings.get()
    const now = this.platform.now()
    const unlocked = this.status === 'unlocked'
    const logins: LoginSummary[] = unlocked
      ? this.savedLogins().map(({ serviceId, email, profiles, settingsUrl }) => ({ serviceId, email, profiles, settingsUrl }))
      : []
    const pending = this.pendingServices(now, logins.map((l) => l.serviceId))
    let pin: AppState['pin']
    if (unlocked) {
      try {
        const period = activePeriod(now, s.changeHour)
        const src = this.pinSources()
        pin = {
          value: pinFor(period, src),
          mode: s.pinMode,
          period,
          nextChangeAt: nextChangeAt(now, s.changeHour).toISOString(),
          nextValue: s.pinMode === 'secret' ? undefined : pinFor(nextPeriod(period), src)
        }
      } catch {
        pin = undefined // custom mode with no PIN saved yet
      }
    }
    return {
      vault: this.status,
      touchIdAvailable: this.platform.touchIdAvailable(),
      settings: structuredClone(s),
      pin,
      logins,
      run: this.runner.state,
      pendingServices: pending,
      dueNow: pending.length > 0,
      hasRecoveryKey: this.hasRecovery,
      recoveryKey: unlocked ? this.recoveryKeyToShow : undefined
    }
  }

  /**
   * Saved logins for services StreamLock still supports. A login for a service
   * that was removed from the catalog (e.g. Apple TV) stays in the vault but is
   * ignored everywhere, so it can never stall a run.
   */
  private savedLogins() {
    return this.vault.read().logins.filter((l) => isServiceId(l.serviceId))
  }

  private pinSources(): PinSources {
    const v = this.vault.read()
    return { mode: this.settings.get().pinMode, secret: this.vault.pinSecret(), customPin: v.customPin }
  }

  private pendingServices(now: Date, withLogins: ServiceId[]): ServiceId[] {
    const s = this.settings.get()
    return withLogins.filter((id) => isPending(s.services[id]?.lastAppliedPeriod, now, s.changeHour))
  }

  private changed(): void {
    this.emit('changed')
  }

  // ---------- vault ----------

  setup(password: string, enableTouchId: boolean): Promise<Result> {
    return attempt(async () => {
      if (this.status !== 'missing') throw new UserError('StreamLock is already set up.')
      const problem = passwordProblem(password)
      if (problem) throw new UserError(problem)
      this.recoveryKeyToShow = await this.vault.create(password)
      this.hasRecovery = true
      this.status = 'unlocked'
      this.unlockedAt = this.platform.now().getTime()
      if (enableTouchId && this.platform.touchIdAvailable()) {
        await this.vault.setKeychainUnlock(true)
        await this.settings.update((s) => (s.touchIdEnabled = true))
      }
      this.platform.setOpenAtLogin(this.settings.get().launchAtLogin)
      this.changed()
    })
  }

  unlockWithPassword(password: string): Promise<Result> {
    return attempt(async () => {
      await this.vault.unlockWithPassword(password)
      this.status = 'unlocked'
      this.unlockedAt = this.platform.now().getTime()
      this.changed()
    })
  }

  unlockWithTouchId(): Promise<Result> {
    return attempt(async () => {
      if (!this.settings.get().touchIdEnabled) throw new UserError('Touch ID unlock is off.')
      const passed = await this.platform.promptTouchId('unlock your streaming logins')
      if (!passed) throw new UserError('Touch ID was cancelled.')
      await this.vault.unlockWithKeychain()
      this.status = 'unlocked'
      this.unlockedAt = this.platform.now().getTime()
      this.changed()
    })
  }

  lock(): void {
    if (this.status !== 'unlocked') return
    // Never lock while the recovery key is on screen: it is shown only once.
    if (this.recoveryKeyToShow) return
    this.runner.dispose()
    this.vault.lock()
    this.status = 'locked'
    this.changed()
  }

  // ---------- forgotten password ----------

  /** Copies the recovery key that is on screen. Cleared from the clipboard after 90 s. */
  copyRecoveryKey(): Result {
    if (this.status !== 'unlocked' || !this.recoveryKeyToShow) return fail('There is no recovery key to copy.')
    this.runner.copyPin(this.recoveryKeyToShow)
    return ok(undefined)
  }

  /** The user confirmed they saved the recovery key; stop showing it. */
  ackRecoveryKey(): void {
    this.recoveryKeyToShow = undefined
    this.changed()
  }

  /** Makes a new recovery key (the old one stops working) and shows it once. */
  createRecoveryKey(): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      this.recoveryKeyToShow = await this.vault.replaceRecoveryKey()
      this.hasRecovery = true
      this.changed()
    })
  }

  resetWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<Result> {
    return attempt(async () => {
      if (this.status === 'missing') throw new UserError('StreamLock is not set up yet.')
      await this.vault.resetPasswordWithRecoveryKey(recoveryKey, newPassword)
      this.status = 'unlocked'
      this.unlockedAt = this.platform.now().getTime()
      this.changed()
    })
  }

  /**
   * Touch ID proves you are at your Mac, so it may replace a forgotten master
   * password. Works locked or unlocked; always asks for Touch ID again.
   */
  resetWithTouchId(newPassword: string): Promise<Result> {
    return attempt(async () => {
      if (this.status === 'missing') throw new UserError('StreamLock is not set up yet.')
      if (!this.settings.get().touchIdEnabled || !this.platform.touchIdAvailable()) {
        throw new UserError('Touch ID unlock is not turned on.')
      }
      const problem = passwordProblem(newPassword)
      if (problem) throw new UserError(problem)
      if (!(await this.platform.promptTouchId('set a new master password'))) throw new UserError('Touch ID was cancelled.')
      if (this.status !== 'unlocked') {
        await this.vault.unlockWithKeychain()
        this.status = 'unlocked'
        this.unlockedAt = this.platform.now().getTime()
      }
      await this.vault.setPassword(newPassword)
      this.changed()
    })
  }

  /** Deletes the vault and all saved logins, then returns to first-run setup. */
  eraseVault(): Promise<Result> {
    return attempt(async () => {
      this.runner.dispose()
      await this.vault.destroy()
      this.status = 'missing'
      this.hasRecovery = false
      this.recoveryKeyToShow = undefined
      await this.settings.update((s) => {
        s.touchIdEnabled = false
        // A custom PIN lived in the vault; fall back to the default mode.
        if (s.pinMode === 'custom') s.pinMode = 'mmyy'
      })
      this.changed()
    })
  }

  changePassword(current: string, next: string): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      await this.vault.changePassword(current, next)
    })
  }

  setTouchId(enabled: boolean): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      if (enabled) {
        if (!this.platform.touchIdAvailable()) throw new UserError('Touch ID is not available on this Mac.')
        if (!(await this.platform.promptTouchId('turn on Touch ID unlock'))) throw new UserError('Touch ID was cancelled.')
      }
      await this.vault.setKeychainUnlock(enabled)
      await this.settings.update((s) => (s.touchIdEnabled = enabled))
      this.changed()
    })
  }

  private requireUnlocked(): void {
    if (this.status !== 'unlocked') throw new UserError('Unlock StreamLock first.')
  }

  // ---------- PIN ----------

  setPinMode(mode: PinMode, customPin?: string): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      if (mode === 'custom') {
        const pin = customPin ?? this.vault.read().customPin
        if (!pin || !isValidPinFormat(pin)) throw new UserError('Enter a 4-digit PIN.')
        const weak = weakPinReason(pin)
        if (weak) throw new UserError(weak)
        if (customPin) await this.vault.update((d) => (d.customPin = customPin))
      }
      const before = this.safeCurrentPin()
      await this.settings.update((s) => (s.pinMode = mode))
      if (this.safeCurrentPin() !== before) await this.markAllPending()
      // A run in progress was started with the old PIN.
      if (this.runner.isRunning) this.runner.cancel()
      this.changed()
    })
  }

  private safeCurrentPin(): string | undefined {
    try {
      return pinFor(activePeriod(this.platform.now(), this.settings.get().changeHour), this.pinSources())
    } catch {
      return undefined
    }
  }

  /** After the PIN itself changes, every service that had one needs the new one. */
  private async markAllPending(): Promise<void> {
    const [y, m] = activePeriod(this.platform.now(), this.settings.get().changeHour).split('-').map(Number) as [number, number]
    const stale = periodOf(new Date(y, m - 2, 1)) // the month before the active one
    await this.settings.update((d) => {
      for (const id of Object.keys(d.services) as ServiceId[]) {
        const rec = d.services[id]
        if (rec?.lastAppliedPeriod) rec.lastAppliedPeriod = stale
      }
    })
  }

  copyPin(): Result {
    if (this.status !== 'unlocked') return fail('Unlock StreamLock first.')
    const pin = this.safeCurrentPin()
    if (!pin) return fail('No PIN yet.')
    this.runner.copyPin(pin)
    return ok(undefined)
  }

  // ---------- logins ----------

  saveLogin(input: LoginInput): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      const svc = getService(input.serviceId)
      if (!svc) throw new UserError('Unknown service.')
      const email = input.email.trim()
      if (!email) throw new UserError('Enter the email or username for this account.')
      const existing = this.vault.read().logins.find((l) => l.serviceId === svc.id)
      if (!existing && !input.password) throw new UserError('Enter the password.')
      let settingsUrl: string | undefined
      if (input.settingsUrl.trim()) {
        const checked = checkSettingsUrl(input.settingsUrl, svc.allowedHosts)
        if (!checked.ok) throw new UserError(`PIN page: ${checked.error}`)
        settingsUrl = checked.url === svc.settingsUrl ? undefined : checked.url
      }
      await this.vault.update((d) => {
        const rest = d.logins.filter((l) => l.serviceId !== svc.id)
        rest.push({
          serviceId: svc.id,
          email,
          password: input.password || existing?.password || '',
          profiles: input.profiles.trim().slice(0, 200),
          settingsUrl
        })
        d.logins = rest
      })
      this.changed()
    })
  }

  deleteLogin(id: ServiceId): Promise<Result> {
    return attempt(async () => {
      this.requireUnlocked()
      await this.vault.update((d) => (d.logins = d.logins.filter((l) => l.serviceId !== id)))
      await this.settings.update((s) => delete s.services[id])
      this.changed()
    })
  }

  // ---------- runs ----------

  /** `onlyPending` = the monthly catch-up; otherwise every saved login. */
  applyAll(onlyPending: boolean): Result {
    if (this.status !== 'unlocked') return fail('Unlock StreamLock first.')
    const now = this.platform.now()
    const order = SERVICES.map((x) => x.id)
    let ids = this.savedLogins().map((l) => l.serviceId).sort((a, b) => order.indexOf(a) - order.indexOf(b))
    if (onlyPending) ids = ids.filter((id) => this.pendingServices(now, [id]).length > 0)
    return this.startRun(ids)
  }

  /** Applies the current PIN to a single service, e.g. one that failed or was skipped. */
  applyOne(id: ServiceId): Result {
    if (this.status !== 'unlocked') return fail('Unlock StreamLock first.')
    if (!this.savedLogins().some((l) => l.serviceId === id)) return fail('Add a login for this service first.')
    return this.startRun([id])
  }

  private startRun(ids: ServiceId[]): Result {
    if (this.runner.isRunning) return fail('Already applying.')
    if (ids.length === 0) return fail('Nothing to apply.')
    const s = this.settings.get()
    const period = activePeriod(this.platform.now(), s.changeHour)
    let pin: string
    try {
      pin = pinFor(period, this.pinSources())
    } catch {
      return fail('Set a PIN first.')
    }
    const creds = new Map<ServiceId, RunCredentials>(
      this.savedLogins().map((l) => [
        l.serviceId,
        { email: l.email, password: l.password, settingsUrl: l.settingsUrl ?? getService(l.serviceId)?.settingsUrl ?? '' }
      ])
    )
    this.runner.start(period, pin, ids, creds, (id) => (id === 'prime' ? adaptPin(pin, s.primePinLength) : pin))
    return ok(undefined)
  }

  goToSettings(id: ServiceId): void {
    this.runner.goToSettings(id)
  }

  markDone(id: ServiceId): void {
    this.runner.markDone(id)
  }

  skip(id: ServiceId): void {
    this.runner.skip(id)
  }

  focusService(id: ServiceId): void {
    this.runner.focus(id)
  }

  cancelRun(): void {
    this.runner.cancel()
  }

  // ---------- preferences ----------

  updatePrefs(patch: Partial<Pick<Settings, 'autoLockMinutes' | 'unlockMinutes' | 'changeHour' | 'notifyDayBefore' | 'primePinLength' | 'launchAtLogin'>>): Promise<Result> {
    return attempt(async () => {
      const next = await this.settings.update((s) => Object.assign(s, patch))
      if (patch.launchAtLogin !== undefined) this.platform.setOpenAtLogin(next.launchAtLogin)
      this.changed()
    })
  }

  // ---------- timers ----------

  /** Called every 30 s and on wake. Notifies; never opens windows by itself. */
  async tick(): Promise<void> {
    const now = this.platform.now()
    const s = this.settings.get()

    if (this.status === 'unlocked' && !this.runner.isRunning) {
      const idle = this.platform.idleSeconds() >= s.autoLockMinutes * 60
      const expired = s.unlockMinutes > 0 && now.getTime() - this.unlockedAt >= s.unlockMinutes * 60_000
      if (idle || expired) this.lock()
    }

    const hasAppliedBefore = Object.values(s.services).some((r) => r?.lastAppliedPeriod)
    if (!hasAppliedBefore) return

    if (s.notifyDayBefore && shouldNoticeDayBefore(now, s.changeHour, s.lastNoticePeriod)) {
      const upcoming = periodOf(nextChangeAt(now, s.changeHour))
      await this.settings.update((d) => (d.lastNoticePeriod = upcoming))
      this.platform.notify('PIN changes tomorrow', 'StreamLock will ask you to apply the new PIN in the morning.')
    }

    const period = activePeriod(now, s.changeHour)
    const due = Object.values(s.services).some((r) => isPending(r?.lastAppliedPeriod, now, s.changeHour))
    if (due && this.dueNoticePeriod !== period) {
      this.dueNoticePeriod = period
      this.platform.notify(
        'New streaming PIN is ready',
        this.status === 'unlocked' ? 'Click the menu bar icon and choose Apply.' : 'Unlock StreamLock to apply it.'
      )
      this.changed()
    }
  }
}
