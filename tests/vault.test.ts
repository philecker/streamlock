import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Vault, VaultError, newRecoveryKey, normalizeRecoveryKey, type Keyring } from '../src/main/vault'

// Fake keychain: reversible but opaque enough to prove the DEK is not stored raw.
const keyring: Keyring = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8')
}

const PW = 'correct horse battery'

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'sl-'))
  return { path: join(dir, 'vault.json'), dir }
}

describe('Vault', () => {
  it('creates, locks and unlocks with the password', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.update((d) => d.logins.push({ serviceId: 'netflix', email: 'a@b.c', password: 'hunter2', profiles: 'Dad' }))
    v.lock()
    expect(v.isUnlocked).toBe(false)
    expect(() => v.read()).toThrow(VaultError)

    const again = new Vault(path, keyring)
    await again.unlockWithPassword(PW)
    expect(again.read().logins[0]?.password).toBe('hunter2')
  }, 20_000)

  it('never writes secrets in plain text and uses 0600', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.update((d) => d.logins.push({ serviceId: 'hulu', email: 'me@x.com', password: 'S3cretPass!', profiles: '' }))
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('S3cretPass!')
    expect(raw).not.toContain('me@x.com')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  }, 20_000)

  it('rejects a wrong password and short new passwords', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await expect(v.create('short')).rejects.toMatchObject({ code: 'bad-password' })
    await v.create(PW)
    v.lock()
    await expect(v.unlockWithPassword('wrong password!')).rejects.toMatchObject({ code: 'bad-password' })
  }, 20_000)

  it('changes the password without touching data', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.update((d) => (d.customPin = '4831'))
    await v.changePassword(PW, 'a brand new passphrase')
    v.lock()
    await expect(v.unlockWithPassword(PW)).rejects.toMatchObject({ code: 'bad-password' })
    await v.unlockWithPassword('a brand new passphrase')
    expect(v.read().customPin).toBe('4831')
  }, 30_000)

  it('unlocks through the keychain once enabled, and stops when disabled', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.setKeychainUnlock(true)
    v.lock()
    await v.unlockWithKeychain()
    expect(v.isUnlocked).toBe(true)
    await v.setKeychainUnlock(false)
    v.lock()
    await expect(v.unlockWithKeychain()).rejects.toMatchObject({ code: 'no-keychain' })
  }, 20_000)

  it('detects tampering', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    v.lock()
    const f = JSON.parse(readFileSync(path, 'utf8'))
    const ct = Buffer.from(f.data.ct, 'base64')
    ct[0] = (ct[0] ?? 0) ^ 1
    f.data.ct = ct.toString('base64')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, JSON.stringify(f))
    await expect(v.unlockWithPassword(PW)).rejects.toMatchObject({ code: 'corrupt' })
  }, 20_000)

  it('keeps every write when updates race', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await Promise.all([
      v.update((d) => d.logins.push({ serviceId: 'netflix', email: '1', password: 'p', profiles: '' })),
      v.update((d) => d.logins.push({ serviceId: 'hulu', email: '2', password: 'p', profiles: '' }))
    ])
    v.lock()
    await v.unlockWithPassword(PW)
    expect(v.read().logins.map((l) => l.serviceId).sort()).toEqual(['hulu', 'netflix'])
  }, 20_000)
})

describe('recovery key', () => {
  it('looks like six groups of four readable characters', () => {
    const k = newRecoveryKey()
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(newRecoveryKey()).not.toBe(k)
  })

  it('accepts sloppy typing but rejects the wrong length', () => {
    const k = newRecoveryKey()
    const plain = k.replace(/-/g, '')
    expect(normalizeRecoveryKey(k.toLowerCase())).toBe(plain)
    expect(normalizeRecoveryKey(` ${plain.slice(0, 12)} ${plain.slice(12)} `)).toBe(plain)
    expect(normalizeRecoveryKey('O0IL' + plain.slice(4))).toBe('0011' + plain.slice(4))
    expect(normalizeRecoveryKey('ABC')).toBeNull()
  })

  it('resets a forgotten password and keeps every login', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    const key = await v.create(PW)
    await v.update((d) => d.logins.push({ serviceId: 'plex', email: 'a', password: 'keepme', profiles: '' }))
    v.lock()

    const later = new Vault(path, keyring)
    await later.resetPasswordWithRecoveryKey(key.toLowerCase().replace(/-/g, ' '), 'my new passphrase')
    expect(later.isUnlocked).toBe(true)
    expect(later.read().logins[0]?.password).toBe('keepme')
    later.lock()
    await expect(later.unlockWithPassword(PW)).rejects.toMatchObject({ code: 'bad-password' })
    await later.unlockWithPassword('my new passphrase')
    // The recovery key keeps working after a reset.
    later.lock()
    await later.resetPasswordWithRecoveryKey(key, 'third passphrase!')
  }, 30_000)

  it('rejects a wrong recovery key and a weak new password', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    const key = await v.create(PW)
    v.lock()
    await expect(v.resetPasswordWithRecoveryKey(newRecoveryKey(), 'my new passphrase')).rejects.toMatchObject({ code: 'bad-recovery' })
    await expect(v.resetPasswordWithRecoveryKey('nonsense', 'my new passphrase')).rejects.toMatchObject({ code: 'bad-recovery' })
    await expect(v.resetPasswordWithRecoveryKey(key, 'short')).rejects.toMatchObject({ code: 'bad-password' })
    expect(v.isUnlocked).toBe(false)
  }, 20_000)

  it('stops accepting the old recovery key once replaced', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    const oldKey = await v.create(PW)
    const newKey = await v.replaceRecoveryKey()
    expect(newKey).not.toBe(oldKey)
    v.lock()
    await expect(v.resetPasswordWithRecoveryKey(oldKey, 'my new passphrase')).rejects.toMatchObject({ code: 'bad-recovery' })
    await v.resetPasswordWithRecoveryKey(newKey, 'my new passphrase')
  }, 20_000)

  it('sets a new password without the old one only while unlocked', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.setPassword('touch id reset pw')
    v.lock()
    await expect(v.setPassword('another one here')).rejects.toMatchObject({ code: 'locked' })
    await v.unlockWithPassword('touch id reset pw')
  }, 20_000)

  it('erases the vault', async () => {
    const { path } = fresh()
    const v = new Vault(path, keyring)
    await v.create(PW)
    await v.destroy()
    expect(await v.exists()).toBe(false)
    expect(v.isUnlocked).toBe(false)
    expect(await v.hasRecoveryKey()).toBe(false)
  }, 20_000)
})
