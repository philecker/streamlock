import { createHmac } from 'node:crypto'
import type { PinMode } from '@shared/types'
import { periodOf } from './schedule'

/** MMYY for the given local date: October 2026 -> "1026". */
export function mmyy(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  return mm + yy
}

/**
 * Unpredictable monthly PIN: HMAC-SHA256(secret, "YYYY-MM") reduced to 4 digits.
 * Rejection sampling over 32-bit words keeps every PIN equally likely.
 */
export function secretPin(secret: Buffer, period: string): string {
  if (secret.length < 16) throw new Error('secret too short')
  const mac = createHmac('sha256', secret).update(`streamlock:pin:${period}`).digest()
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % 10_000)
  for (let i = 0; i + 4 <= mac.length; i += 4) {
    const n = mac.readUInt32BE(i)
    if (n < limit) return String(n % 10_000).padStart(4, '0')
  }
  // Probability of reaching here is ~(1e-6)^8; fall back deterministically.
  return String(mac.readUInt32BE(0) % 10_000).padStart(4, '0')
}

export interface PinSources {
  mode: PinMode
  secret?: Buffer
  customPin?: string
}

/** The 4-digit PIN for a given period. Throws if the mode's inputs are missing. */
export function pinFor(period: string, src: PinSources): string {
  switch (src.mode) {
    case 'mmyy': {
      const [y, m] = period.split('-').map(Number)
      if (!y || !m) throw new Error(`bad period ${period}`)
      return mmyy(new Date(y, m - 1, 1))
    }
    case 'secret':
      if (!src.secret) throw new Error('secret mode needs the vault secret')
      return secretPin(src.secret, period)
    case 'custom':
      if (!src.customPin || !isValidPinFormat(src.customPin)) throw new Error('no custom PIN set')
      return src.customPin
  }
}

export function currentPin(now: Date, src: PinSources): string {
  return pinFor(periodOf(now), src)
}

/** Some Prime Video regions use 5 digits; pad with a leading zero. */
export function adaptPin(pin: string, length: 4 | 5): string {
  return length === 5 ? pin.padStart(5, '0') : pin
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** Returns a reason the PIN is weak, or null. Used for custom PINs only. */
export function weakPinReason(pin: string): string | null {
  if (!isValidPinFormat(pin)) return 'Use exactly 4 digits.'
  if (/^(\d)\1{3}$/.test(pin)) return 'Avoid repeating one digit.'
  const d = pin.split('').map(Number)
  const step = (d[1] ?? 0) - (d[0] ?? 0)
  if ((step === 1 || step === -1) && d.every((v, i) => i === 0 || v - (d[i - 1] ?? 0) === step)) {
    return 'Avoid straight runs like 1234.'
  }
  if (/^(19|20)\d\d$/.test(pin)) return 'Avoid years; they are easy to guess.'
  return null
}
