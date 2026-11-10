// Encrypted credential vault.
//
// Layout on disk (vault.json, mode 0600):
//   - A random 256-bit data key (DEK) encrypts the payload with AES-256-GCM.
//   - The DEK is wrapped up to three times:
//       * with a key derived from the master password (scrypt), always;
//       * with a key derived from the recovery key (scrypt), if one was made;
//       * with the OS keychain via Electron safeStorage, only if Touch ID is on.
// Changing or resetting the password re-wraps the DEK; the payload is untouched,
// so a reset keeps every saved login.

import { randomBytes, createCipheriv, createDecipheriv, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ServiceId } from '@shared/services'

export interface StoredLogin {
  serviceId: ServiceId
  email: string
  password: string
  profiles: string
  /** Override for the service's PIN page (validated to the service's own hosts). */
  settingsUrl?: string
}

export interface VaultPayload {
  v: 1
  /** 32 random bytes (hex) for the unpredictable "secret" PIN mode. */
  pinSecret: string
  customPin?: string
  logins: StoredLogin[]
}

interface Sealed {
  iv: string
  tag: string
  ct: string
}

interface VaultFile {
  v: 1
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number }
  /** DEK sealed with the password-derived key. */
  dekByPassword: Sealed
  /** DEK sealed with the recovery-key-derived key, if a recovery key exists. */
  recovery?: { salt: string; N: number; r: number; p: number; dek: Sealed }
  /** DEK sealed by the OS keychain (base64), present only when Touch ID is on. */
  dekByKeychain?: string
  data: Sealed
}

/** Abstraction over Electron safeStorage so the vault is testable outside Electron. */
export interface Keyring {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(sealed: Buffer): string
}

export class VaultError extends Error {
  constructor(
    public code: 'missing' | 'exists' | 'locked' | 'bad-password' | 'bad-recovery' | 'no-recovery' | 'corrupt' | 'no-keychain',
    message: string
  ) {
    super(message)
  }
}

const KDF = { N: 2 ** 17, r: 8, p: 1 } as const
/** The recovery key is 120 random bits, so a lighter KDF is plenty. */
const RECOVERY_KDF = { N: 2 ** 15, r: 8, p: 1 } as const
const MIN_PASSWORD = 10

/** Crockford base32: no I, L, O or U, so the key is easy to read and type. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 120-bit key shown as six groups of four: "7KQ2-9XMB-…". */
export function newRecoveryKey(): string {
  const bytes = randomBytes(15)
  let bits = 0
  let acc = 0
  let out = ''
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** Accepts the key however it was typed: any case, with or without dashes or spaces. */
export function normalizeRecoveryKey(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (s.length !== 24 || [...s].some((c) => !B32.includes(c))) return null
  return s
}

function scrypt(password: string, salt: Buffer, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, 32, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

function seal(key: Buffer, plain: Buffer, aad: string): Sealed {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }
}

function open(key: Buffer, s: Sealed, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(s.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()])
}

async function sealRecovery(recoveryKey: string, dek: Buffer): Promise<NonNullable<VaultFile['recovery']>> {
  const normalized = normalizeRecoveryKey(recoveryKey)
  if (!normalized) throw new Error('bad recovery key format')
  const salt = randomBytes(16)
  const rk = await scrypt(normalized, salt, RECOVERY_KDF)
  const dekSealed = seal(rk, dek, 'dek-recovery')
  rk.fill(0)
  return { salt: salt.toString('base64'), ...RECOVERY_KDF, dek: dekSealed }
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  return null
}

export class Vault {
  private dek: Buffer | null = null
  private payload: VaultPayload | null = null
  /** Serializes writes so two quick edits cannot interleave on disk. */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly keyring: Keyring
  ) {}

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path)
      return true
    } catch {
      return false
    }
  }

  get isUnlocked(): boolean {
    return this.dek !== null && this.payload !== null
  }

  async hasRecoveryKey(): Promise<boolean> {
    if (!(await this.exists())) return false
    return Boolean((await this.readFile()).recovery)
  }

  async hasKeychainUnlock(): Promise<boolean> {
    if (!(await this.exists())) return false
    return Boolean((await this.readFile()).dekByKeychain)
  }

  /** Creates the vault and returns its recovery key, to be shown to the user once. */
  async create(password: string): Promise<string> {
    const problem = passwordProblem(password)
    if (problem) throw new VaultError('bad-password', problem)
    if (await this.exists()) throw new VaultError('exists', 'A vault already exists.')
    const dek = randomBytes(32)
    const payload: VaultPayload = { v: 1, pinSecret: randomBytes(32).toString('hex'), logins: [] }
    const salt = randomBytes(16)
    const kek = await scrypt(password, salt, KDF)
    const file: VaultFile = {
      v: 1,
      kdf: { name: 'scrypt', salt: salt.toString('base64'), ...KDF },
      dekByPassword: seal(kek, dek, 'dek'),
      data: seal(dek, Buffer.from(JSON.stringify(payload)), 'data')
    }
    kek.fill(0)
    const recoveryKey = newRecoveryKey()
    file.recovery = await sealRecovery(recoveryKey, dek)
    await this.writeFile(file)
    this.dek = dek
    this.payload = payload
    return recoveryKey
  }

  /** Makes a new recovery key (the old one stops working) and returns it. */
  async replaceRecoveryKey(): Promise<string> {
    const dek = this.requireDek()
    const key = newRecoveryKey()
    const recovery = await sealRecovery(key, dek)
    await this.mutateFile(async (file) => {
      file.recovery = recovery
    })
    return key
  }

  /** Sets a new master password using the recovery key, keeping all data, and unlocks. */
  async resetPasswordWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<void> {
    const problem = passwordProblem(newPassword)
    if (problem) throw new VaultError('bad-password', problem)
    const file = await this.readFile()
    if (!file.recovery) throw new VaultError('no-recovery', 'This vault has no recovery key.')
    const normalized = normalizeRecoveryKey(recoveryKey)
    if (!normalized) throw new VaultError('bad-recovery', 'A recovery key has 24 letters and numbers.')
    const { salt, N, r, p, dek: sealed } = file.recovery
    const rk = await scrypt(normalized, Buffer.from(salt, 'base64'), { N, r, p })
    let dek: Buffer
    try {
      dek = open(rk, sealed, 'dek-recovery')
    } catch {
      throw new VaultError('bad-recovery', 'That recovery key is not right.')
    } finally {
      rk.fill(0)
    }
    this.finishUnlock(file, dek)
    await this.setPassword(newPassword)
  }

  /**
   * Sets a new master password without the old one. Only for an unlocked vault
   * whose owner has just proved presence another way (Touch ID).
   */
  async setPassword(newPassword: string): Promise<void> {
    const problem = passwordProblem(newPassword)
    if (problem) throw new VaultError('bad-password', problem)
    const dek = this.requireDek()
    const salt = randomBytes(16)
    const kek = await scrypt(newPassword, salt, KDF)
    const wrapped = seal(kek, dek, 'dek')
    kek.fill(0)
    await this.mutateFile(async (file) => {
      file.kdf = { name: 'scrypt', salt: salt.toString('base64'), ...KDF }
      file.dekByPassword = wrapped
    })
  }

  /** Deletes the vault and every saved login. Cannot be undone. */
  async destroy(): Promise<void> {
    this.lock()
    await this.writeChain
    await fs.rm(this.path, { force: true })
  }

  async unlockWithPassword(password: string): Promise<void> {
    const file = await this.readFile()
    const kek = await scrypt(password, Buffer.from(file.kdf.salt, 'base64'), file.kdf)
    let dek: Buffer
    try {
      dek = open(kek, file.dekByPassword, 'dek')
    } catch {
      throw new VaultError('bad-password', 'That password is not right.')
    } finally {
      kek.fill(0)
    }
    this.finishUnlock(file, dek)
  }

  /** Call only after the OS has confirmed Touch ID. */
  async unlockWithKeychain(): Promise<void> {
    const file = await this.readFile()
    if (!file.dekByKeychain || !this.keyring.isAvailable()) {
      throw new VaultError('no-keychain', 'Touch ID unlock is not set up.')
    }
    const dek = Buffer.from(this.keyring.decrypt(Buffer.from(file.dekByKeychain, 'base64')), 'hex')
    this.finishUnlock(file, dek)
  }

  private finishUnlock(file: VaultFile, dek: Buffer): void {
    try {
      const payload = JSON.parse(open(dek, file.data, 'data').toString('utf8')) as VaultPayload
      if (payload.v !== 1 || !Array.isArray(payload.logins)) throw new Error('shape')
      if (this.dek && this.dek !== dek) this.dek.fill(0)
      this.dek = dek
      this.payload = payload
    } catch {
      dek.fill(0)
      throw new VaultError('corrupt', 'The vault could not be read.')
    }
  }

  lock(): void {
    this.dek?.fill(0)
    this.dek = null
    this.payload = null
  }

  /** Verifies the master password without changing lock state. */
  async verifyPassword(password: string): Promise<boolean> {
    const file = await this.readFile()
    const kek = await scrypt(password, Buffer.from(file.kdf.salt, 'base64'), file.kdf)
    try {
      const dek = open(kek, file.dekByPassword, 'dek')
      const same = this.dek ? timingSafeEqual(dek, this.dek) : true
      dek.fill(0)
      return same
    } catch {
      return false
    } finally {
      kek.fill(0)
    }
  }

  async changePassword(current: string, next: string): Promise<void> {
    const problem = passwordProblem(next)
    if (problem) throw new VaultError('bad-password', problem)
    if (!(await this.verifyPassword(current))) throw new VaultError('bad-password', 'Current password is not right.')
    await this.setPassword(next)
  }

  async setKeychainUnlock(enabled: boolean): Promise<void> {
    const dek = this.requireDek()
    if (enabled && !this.keyring.isAvailable()) throw new VaultError('no-keychain', 'Keychain is not available.')
    await this.mutateFile(async (file) => {
      if (enabled) file.dekByKeychain = this.keyring.encrypt(dek.toString('hex')).toString('base64')
      else delete file.dekByKeychain
    })
  }

  read(): Readonly<VaultPayload> {
    if (!this.payload) throw new VaultError('locked', 'Vault is locked.')
    return this.payload
  }

  pinSecret(): Buffer {
    return Buffer.from(this.read().pinSecret, 'hex')
  }

  /**
   * Applies `fn` to a copy of the payload and persists it. The copy is taken
   * inside the write queue, so concurrent updates each see the previous result
   * instead of overwriting each other.
   */
  async update(fn: (draft: VaultPayload) => void): Promise<void> {
    await this.mutateFile(async (file) => {
      const dek = this.requireDek()
      const draft = structuredClone(this.read()) as VaultPayload
      fn(draft)
      file.data = seal(dek, Buffer.from(JSON.stringify(draft)), 'data')
      return () => {
        this.payload = draft
      }
    })
  }

  private requireDek(): Buffer {
    if (!this.dek) throw new VaultError('locked', 'Vault is locked.')
    return this.dek
  }

  private async readFile(): Promise<VaultFile> {
    let raw: string
    try {
      raw = await fs.readFile(this.path, 'utf8')
    } catch {
      throw new VaultError('missing', 'No vault yet.')
    }
    try {
      const f = JSON.parse(raw) as VaultFile
      if (f.v !== 1 || f.kdf?.name !== 'scrypt' || !f.dekByPassword || !f.data) throw new Error('shape')
      return f
    } catch {
      throw new VaultError('corrupt', 'The vault file is damaged.')
    }
  }

  /**
   * Read-modify-write of the vault file, one at a time. `fn` may return a
   * commit callback that runs only after the file is safely on disk.
   */
  private mutateFile(fn: (file: VaultFile) => Promise<void | (() => void)>): Promise<void> {
    const run = this.writeChain.then(async () => {
      const file = await this.readFile()
      const commit = await fn(file)
      await this.writeFile(file)
      commit?.()
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  /** Atomic write: temp file in the same directory, fsync, rename. */
  private async writeFile(file: VaultFile): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`
    const handle = await fs.open(tmp, 'w', 0o600)
    try {
      await handle.writeFile(JSON.stringify(file))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, this.path)
  }
}
