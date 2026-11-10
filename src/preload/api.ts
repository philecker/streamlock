import type { AppState, LoginInput, PinMode, Result, Settings } from '../shared/types'
import type { ServiceId } from '../shared/services'

export type Prefs = Partial<Pick<Settings, 'autoLockMinutes' | 'unlockMinutes' | 'changeHour' | 'notifyDayBefore' | 'primePinLength' | 'launchAtLogin'>>

export interface StreamLockApi {
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  setup(password: string, enableTouchId: boolean): Promise<Result>
  unlock(password: string): Promise<Result>
  unlockTouchId(): Promise<Result>
  lock(): Promise<void>
  changePassword(current: string, next: string): Promise<Result>
  setTouchId(enabled: boolean): Promise<Result>
  ackRecoveryKey(): Promise<void>
  copyRecoveryKey(): Promise<Result>
  createRecoveryKey(): Promise<Result>
  resetWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<Result>
  resetWithTouchId(newPassword: string): Promise<Result>
  eraseVault(): Promise<Result>
  setPinMode(mode: PinMode, customPin?: string): Promise<Result>
  copyPin(): Promise<Result>
  saveLogin(input: LoginInput): Promise<Result>
  deleteLogin(id: ServiceId): Promise<Result>
  apply(onlyPending: boolean): Promise<Result>
  applyOne(id: ServiceId): Promise<Result>
  goToSettings(id: ServiceId): Promise<void>
  markDone(id: ServiceId): Promise<void>
  skip(id: ServiceId): Promise<void>
  focus(id: ServiceId): Promise<void>
  cancelRun(): Promise<void>
  updatePrefs(patch: Prefs): Promise<Result>
  openSettings(): Promise<void>
  quit(): Promise<void>
}
