import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Controller, type Platform } from '../src/main/controller'
import { Vault, type Keyring } from '../src/main/vault'
import { SettingsStore } from '../src/main/settings'
import type { ServiceId } from '../src/shared/services'
import type { RunState } from '../src/shared/types'

const keyring: Keyring = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s).reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString()
}

/** Stands in for the Electron runner; records what it was asked to do. */
class FakeRunner extends EventEmitter {
  run: RunState | null = null
  started: { services: ServiceId[]; pins: Record<string, string> } | null = null
  creds: Map<ServiceId, { settingsUrl: string }> | null = null
  copied: string[] = []
  get state() {
    return this.run ?? undefined
  }
  get isRunning() {
    return this.run !== null
  }
  start(period: string, pin: string, services: ServiceId[], c: Map<ServiceId, { settingsUrl: string }>, pinFor: (id: ServiceId) => string) {
    this.creds = c
    this.started = { services, pins: Object.fromEntries(services.map((s) => [s, pinFor(s)])) }
    this.run = { period, pin, startedAt: '', items: services.map((serviceId) => ({ serviceId, status: 'needs-you' as const })) }
  }
  markDone(id: ServiceId) {
    if (!this.run) return
    this.emit('applied', id, this.run.period)
  }
  skip() {}
  focus() {}
  goToSettings() {}
  cancel() {
    this.run = null
  }
  dispose() {
    this.run = null
  }
  copyPin(p: string) {
    this.copied.push(p)
  }
}

function makePlatform(now: Date, overrides: Partial<Platform> = {}): Platform & { notes: string[]; clock: { now: Date } } {
  const notes: string[] = []
  const clock = { now }
  return {
    touchIdAvailable: () => true,
    promptTouchId: async () => true,
    notify: (t) => void notes.push(t),
    idleSeconds: () => 0,
    setOpenAtLogin: () => undefined,
    now: () => clock.now,
    notes,
    clock,
    ...overrides
  }
}

/** Sets up a fresh vault. Like a user, it dismisses the recovery key unless asked not to. */
async function setup(now = new Date(2026, 9, 20, 12), platform = makePlatform(now), { keepKeyOnScreen = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'slc-'))
  const runner = new FakeRunner()
  const vault = new Vault(join(dir, 'v.json'), keyring)
  const c = new Controller(vault, new SettingsStore(join(dir, 's.json')), runner as never, platform)
  await c.init()
  const r = await c.setup('correct horse battery', false)
  expect(r.ok).toBe(true)
  const key = c.state().recoveryKey as string
  if (!keepKeyOnScreen) c.ackRecoveryKey()
  return { c, runner, platform, key, vault }
}

const flush = () => new Promise((r) => setTimeout(r, 20))

describe('Controller', () => {
  it('shows MMYY for the month and previews next month', async () => {
    const { c } = await setup()
    const s = c.state()
    expect(s.pin?.value).toBe('1026')
    expect(s.pin?.nextValue).toBe('1126')
    expect(s.logins).toEqual([])
  }, 20_000)

  it('never sends passwords to the UI and keeps the old one when left blank', async () => {
    const { c } = await setup()
    await c.saveLogin({ serviceId: 'netflix', email: 'me@x.com', password: 'pw1', profiles: 'Dad', settingsUrl: '' })
    await c.saveLogin({ serviceId: 'netflix', email: 'me2@x.com', password: '', profiles: 'Dad, Mom', settingsUrl: '' })
    expect(JSON.stringify(c.state())).not.toContain('pw1')
    expect(c.state().logins).toEqual([{ serviceId: 'netflix', email: 'me2@x.com', profiles: 'Dad, Mom' }])
  }, 20_000)

  it('requires a password for a brand-new login', async () => {
    const { c } = await setup()
    const r = await c.saveLogin({ serviceId: 'hulu', email: 'a@b.c', password: '', profiles: '', settingsUrl: '' })
    expect(r.ok).toBe(false)
  }, 20_000)

  it('applies in catalog order and pads only Prime when set to 5 digits', async () => {
    const { c, runner } = await setup()
    await c.updatePrefs({ primePinLength: 5 })
    for (const id of ['prime', 'netflix', 'hulu'] as ServiceId[]) {
      await c.saveLogin({ serviceId: id, email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    }
    expect(c.applyAll(false).ok).toBe(true)
    expect(runner.started?.services).toEqual(['netflix', 'hulu', 'prime'])
    expect(runner.started?.pins).toEqual({ netflix: '1026', hulu: '1026', prime: '01026' })
  }, 20_000)

  it('records the period when a service is marked done, then goes pending next month', async () => {
    const { c, runner, platform } = await setup()
    await c.saveLogin({ serviceId: 'netflix', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    c.applyAll(false)
    runner.markDone('netflix')
    await flush()
    expect(c.state().settings.services.netflix?.lastAppliedPeriod).toBe('2026-10')
    expect(c.state().dueNow).toBe(false)

    platform.clock.now = new Date(2026, 10, 1, 9, 5)
    runner.cancel()
    expect(c.state().pendingServices).toEqual(['netflix'])
    await c.tick()
    expect(platform.notes).toContain('New streaming PIN is ready')
    // The due notice fires once per period, not every tick.
    await c.tick()
    expect(platform.notes.filter((n) => n === 'New streaming PIN is ready')).toHaveLength(1)
  }, 20_000)

  it('marks every applied service pending when the PIN mode changes', async () => {
    const { c, runner } = await setup()
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    c.applyAll(false)
    runner.markDone('hulu')
    await flush()
    runner.cancel()
    expect(c.state().dueNow).toBe(false)
    expect((await c.setPinMode('secret')).ok).toBe(true)
    expect(c.state().pendingServices).toEqual(['hulu'])
    expect(c.state().pin?.nextValue).toBeUndefined()
  }, 20_000)

  it('rejects weak custom PINs and cancels a run started with the old PIN', async () => {
    const { c, runner } = await setup()
    expect((await c.setPinMode('custom', '1234')).ok).toBe(false)
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    c.applyAll(false)
    expect(runner.isRunning).toBe(true)
    expect((await c.setPinMode('custom', '4831')).ok).toBe(true)
    expect(runner.isRunning).toBe(false)
    expect(c.state().pin?.value).toBe('4831')
  }, 20_000)

  it('auto-locks when idle, but not mid-run', async () => {
    let idle = 0
    const platform = makePlatform(new Date(2026, 9, 20, 12), { idleSeconds: () => idle })
    const { c, runner } = await setup(undefined, platform)
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    c.applyAll(false)
    idle = 3600
    await c.tick()
    expect(c.state().vault).toBe('unlocked')
    runner.cancel()
    await c.tick()
    expect(c.state().vault).toBe('locked')
    expect(c.state().pin).toBeUndefined()
    expect(c.state().logins).toEqual([])
  }, 20_000)

  it('locks when the stay-unlocked time runs out, even while in use', async () => {
    const { c, platform } = await setup()
    await c.updatePrefs({ unlockMinutes: 15 })
    platform.clock.now = new Date(2026, 9, 20, 12, 14)
    await c.tick()
    expect(c.state().vault).toBe('unlocked')
    platform.clock.now = new Date(2026, 9, 20, 12, 15)
    await c.tick()
    expect(c.state().vault).toBe('locked')
  }, 20_000)

  it('stays unlocked with no time limit when set to "until I lock it"', async () => {
    const { c, platform } = await setup()
    await c.updatePrefs({ unlockMinutes: 0 })
    platform.clock.now = new Date(2026, 9, 21, 12, 0)
    await c.tick()
    expect(c.state().vault).toBe('unlocked')
  }, 20_000)

  it('ignores stay-unlocked values that are not offered', async () => {
    const { c } = await setup()
    await c.updatePrefs({ unlockMinutes: 7 })
    expect(c.state().settings.unlockMinutes).toBe(60)
  }, 20_000)

  it('updates just one service', async () => {
    const { c, runner } = await setup()
    for (const id of ['netflix', 'hulu', 'plex'] as ServiceId[]) {
      await c.saveLogin({ serviceId: id, email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    }
    expect(c.applyOne('hulu').ok).toBe(true)
    expect(runner.started?.services).toEqual(['hulu'])
    runner.markDone('hulu')
    await flush()
    expect(c.state().settings.services.hulu?.lastAppliedPeriod).toBe('2026-10')
    expect(c.state().settings.services.netflix).toBeUndefined()
  }, 20_000)

  it('refuses to update a service with no saved login', async () => {
    const { c } = await setup()
    expect(c.applyOne('prime').ok).toBe(false)
  }, 20_000)

  it('uses your PIN page address, but only on the service own domains', async () => {
    const { c, runner } = await setup()
    const bad = await c.saveLogin({ serviceId: 'netflix', email: 'e', password: 'p', profiles: '', settingsUrl: 'https://evil.example/netflix' })
    expect(bad.ok).toBe(false)
    const good = await c.saveLogin({ serviceId: 'netflix', email: 'e', password: 'p', profiles: '', settingsUrl: 'www.netflix.com/account/lock' })
    expect(good.ok).toBe(true)
    expect(c.state().logins[0]?.settingsUrl).toBe('https://www.netflix.com/account/lock')
    c.applyOne('netflix')
    expect(runner.creds?.get('netflix')?.settingsUrl).toBe('https://www.netflix.com/account/lock')
    // Clearing it goes back to the built-in page.
    runner.cancel()
    await c.saveLogin({ serviceId: 'netflix', email: 'e', password: '', profiles: '', settingsUrl: '' })
    expect(c.state().logins[0]?.settingsUrl).toBeUndefined()
  }, 20_000)

  it('shows the recovery key once after setup, and never locks while it is on screen', async () => {
    let idle = 0
    const platform = makePlatform(new Date(2026, 9, 20, 12), { idleSeconds: () => idle })
    const { c, runner } = await setup(undefined, platform, { keepKeyOnScreen: true })
    const key = c.state().recoveryKey
    expect(key).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/)
    expect(c.state().hasRecoveryKey).toBe(true)
    idle = 3600
    await c.tick()
    expect(c.state().vault).toBe('unlocked')
    expect(c.copyRecoveryKey().ok).toBe(true)
    expect(runner.copied).toEqual([key])
    c.ackRecoveryKey()
    expect(c.state().recoveryKey).toBeUndefined()
    expect(c.copyRecoveryKey().ok).toBe(false)
    await c.tick()
    expect(c.state().vault).toBe('locked')
  }, 20_000)

  it('resets a forgotten password with the recovery key', async () => {
    const { c, key } = await setup()
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    c.lock()
    expect((await c.resetWithRecoveryKey(key, 'brand new password')).ok).toBe(true)
    expect(c.state().vault).toBe('unlocked')
    expect(c.state().logins.map((l) => l.serviceId)).toEqual(['hulu'])
    c.lock()
    expect((await c.unlockWithPassword('brand new password')).ok).toBe(true)
  }, 30_000)

  it('says plainly when the recovery key is wrong', async () => {
    const { c } = await setup()
    c.ackRecoveryKey()
    c.lock()
    const r = await c.resetWithRecoveryKey('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'brand new password')
    expect(r).toEqual({ ok: false, error: 'That recovery key is not right.' })
    expect(c.state().vault).toBe('locked')
  }, 20_000)

  it('replaces the recovery key and shows the new one', async () => {
    const { c, key: first } = await setup()
    expect(c.state().recoveryKey).toBeUndefined()
    expect((await c.createRecoveryKey()).ok).toBe(true)
    expect(c.state().recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/)
    expect(c.state().recoveryKey).not.toBe(first)
  }, 20_000)

  it('resets the password with Touch ID, from locked, only after a fresh prompt', async () => {
    const promptTouchId = vi.fn(async () => true)
    const platform = makePlatform(new Date(2026, 9, 20), { promptTouchId })
    const { c } = await setup(undefined, platform)
    c.ackRecoveryKey()
    // Off until Touch ID unlock is turned on.
    expect((await c.resetWithTouchId('touch reset password')).ok).toBe(false)
    await c.setTouchId(true)
    c.lock()
    promptTouchId.mockResolvedValueOnce(false)
    expect((await c.resetWithTouchId('touch reset password')).ok).toBe(false)
    expect(c.state().vault).toBe('locked')
    expect((await c.resetWithTouchId('touch reset password')).ok).toBe(true)
    expect(c.state().vault).toBe('unlocked')
    c.lock()
    expect((await c.unlockWithPassword('touch reset password')).ok).toBe(true)
  }, 30_000)

  it('erases everything and goes back to setup', async () => {
    const { c } = await setup()
    c.ackRecoveryKey()
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    await c.setPinMode('custom', '4831')
    c.lock()
    expect((await c.eraseVault()).ok).toBe(true)
    const s = c.state()
    expect(s.vault).toBe('missing')
    expect(s.logins).toEqual([])
    expect(s.hasRecoveryKey).toBe(false)
    expect(s.settings.pinMode).toBe('mmyy')
    expect((await c.setup('a fresh password', false)).ok).toBe(true)
  }, 30_000)

  it('ignores a saved login for a service that was removed (Apple TV)', async () => {
    const { c, runner, vault } = await setup()
    await c.saveLogin({ serviceId: 'hulu', email: 'e', password: 'p', profiles: '', settingsUrl: '' })
    await vault.update((d) => d.logins.push({ serviceId: 'appletv' as ServiceId, email: 'old', password: 'p', profiles: '' }))
    expect(c.state().logins.map((l) => l.serviceId)).toEqual(['hulu'])
    expect(c.applyAll(false).ok).toBe(true)
    expect(runner.started?.services).toEqual(['hulu'])
  }, 20_000)

  it('does not notify before anything has ever been applied', async () => {
    const { c, platform } = await setup(new Date(2026, 9, 31, 10))
    await c.tick()
    expect(platform.notes).toEqual([])
  }, 20_000)

  it('refuses Touch ID unlock when the prompt is cancelled', async () => {
    const promptTouchId = vi.fn(async () => true)
    const platform = makePlatform(new Date(2026, 9, 20), { promptTouchId })
    const { c } = await setup(undefined, platform)
    expect((await c.setTouchId(true)).ok).toBe(true)
    c.lock()
    promptTouchId.mockResolvedValueOnce(false)
    expect((await c.unlockWithTouchId()).ok).toBe(false)
    expect(c.state().vault).toBe('locked')
    expect((await c.unlockWithTouchId()).ok).toBe(true)
  }, 20_000)
})
