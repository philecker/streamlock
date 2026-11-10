import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Settings } from '@shared/types'
import { isServiceId } from '@shared/services'

export const DEFAULT_SETTINGS: Settings = {
  pinMode: 'mmyy',
  autoLockMinutes: 5,
  unlockMinutes: 60,
  changeHour: 9,
  notifyDayBefore: true,
  primePinLength: 4,
  launchAtLogin: true,
  touchIdEnabled: false,
  services: {}
}

/** Allowed "stay unlocked" durations in minutes; 0 means until you lock it. */
export const UNLOCK_CHOICES = [15, 60, 240, 480, 0]

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** Accepts unknown JSON and returns valid settings, falling back field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const int = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : dflt
  const services: Settings['services'] = {}
  if (r.services && typeof r.services === 'object') {
    for (const [id, rec] of Object.entries(r.services as Record<string, unknown>)) {
      if (!isServiceId(id) || !rec || typeof rec !== 'object') continue
      const { lastAppliedPeriod, lastAppliedAt } = rec as Record<string, unknown>
      services[id] = {
        lastAppliedPeriod: typeof lastAppliedPeriod === 'string' && PERIOD.test(lastAppliedPeriod) ? lastAppliedPeriod : undefined,
        lastAppliedAt: typeof lastAppliedAt === 'string' ? lastAppliedAt : undefined
      }
    }
  }
  return {
    pinMode: r.pinMode === 'secret' || r.pinMode === 'custom' || r.pinMode === 'mmyy' ? r.pinMode : d.pinMode,
    autoLockMinutes: int(r.autoLockMinutes, 1, 120, d.autoLockMinutes),
    unlockMinutes: UNLOCK_CHOICES.includes(r.unlockMinutes as number) ? (r.unlockMinutes as number) : d.unlockMinutes,
    changeHour: int(r.changeHour, 0, 23, d.changeHour),
    notifyDayBefore: typeof r.notifyDayBefore === 'boolean' ? r.notifyDayBefore : d.notifyDayBefore,
    primePinLength: r.primePinLength === 5 ? 5 : 4,
    launchAtLogin: typeof r.launchAtLogin === 'boolean' ? r.launchAtLogin : d.launchAtLogin,
    touchIdEnabled: typeof r.touchIdEnabled === 'boolean' ? r.touchIdEnabled : d.touchIdEnabled,
    lastNoticePeriod: typeof r.lastNoticePeriod === 'string' && PERIOD.test(r.lastNoticePeriod) ? r.lastNoticePeriod : undefined,
    services
  }
}

export class SettingsStore {
  private value: Settings = structuredClone(DEFAULT_SETTINGS)
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<Settings> {
    try {
      this.value = sanitizeSettings(JSON.parse(await fs.readFile(this.path, 'utf8')))
    } catch {
      this.value = structuredClone(DEFAULT_SETTINGS)
    }
    return this.value
  }

  get(): Readonly<Settings> {
    return this.value
  }

  async update(fn: (draft: Settings) => void): Promise<Settings> {
    const draft = structuredClone(this.value)
    fn(draft)
    this.value = sanitizeSettings(draft)
    const snapshot = JSON.stringify(this.value, null, 2)
    const run = this.writeChain.then(async () => {
      await fs.mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(tmp, snapshot, { mode: 0o600 })
      await fs.rename(tmp, this.path)
    })
    this.writeChain = run.catch(() => undefined)
    await run
    return this.value
  }
}
