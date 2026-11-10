import type { ServiceId } from './services'

export type PinMode = 'mmyy' | 'secret' | 'custom'

export type VaultStatus = 'missing' | 'locked' | 'unlocked'

/** Non-secret preferences, stored in plain JSON. */
export interface Settings {
  pinMode: PinMode
  autoLockMinutes: number
  /** Lock this many minutes after unlocking, even if in use. 0 = no limit. */
  unlockMinutes: number
  /** Local hour (0–23) on the 1st when the monthly change runs. */
  changeHour: number
  notifyDayBefore: boolean
  /** Prime Video uses a 5-digit PIN in some regions. */
  primePinLength: 4 | 5
  launchAtLogin: boolean
  touchIdEnabled: boolean
  /** Last period ('YYYY-MM') a day-before notice was shown for. */
  lastNoticePeriod?: string
  services: Partial<Record<ServiceId, ServiceRecord>>
}

export interface ServiceRecord {
  /** Period ('YYYY-MM') whose PIN was last confirmed on this service. */
  lastAppliedPeriod?: string
  lastAppliedAt?: string
}

/** What the renderer may know about a saved login. Never the password. */
export interface LoginSummary {
  serviceId: ServiceId
  email: string
  profiles: string
  /** Your own address for this service's PIN page, if you set one. */
  settingsUrl?: string
}

export type RunItemStatus = 'queued' | 'needs-you' | 'done' | 'skipped'

export interface RunItem {
  serviceId: ServiceId
  status: RunItemStatus
}

export interface RunState {
  period: string
  pin: string
  items: RunItem[]
  startedAt: string
}

export interface PinInfo {
  value: string
  mode: PinMode
  period: string
  nextChangeAt: string
  /** Only for predictable modes, so the UI can preview it. */
  nextValue?: string
}

export interface AppState {
  vault: VaultStatus
  touchIdAvailable: boolean
  settings: Settings
  /** Present only while unlocked. */
  pin?: PinInfo
  logins: LoginSummary[]
  run?: RunState
  /** Services whose current-period PIN has not been confirmed. */
  pendingServices: ServiceId[]
  dueNow: boolean
  /** The vault has a recovery key. */
  hasRecoveryKey: boolean
  /** Shown once, right after it is made, until the user confirms they saved it. */
  recoveryKey?: string
}

export interface LoginInput {
  serviceId: ServiceId
  email: string
  /** Empty string means "keep the saved password". */
  password: string
  profiles: string
  /** Address of the PIN page; empty string means use the built-in one. */
  settingsUrl: string
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }
