import { describe, expect, it } from 'vitest'
import { adaptPin, mmyy, pinFor, secretPin, weakPinReason } from '../src/main/pin'

describe('mmyy', () => {
  it('formats month and two-digit year', () => {
    expect(mmyy(new Date(2026, 9, 20))).toBe('1026')
    expect(mmyy(new Date(2026, 10, 1))).toBe('1126')
    expect(mmyy(new Date(2030, 0, 15))).toBe('0130')
    expect(mmyy(new Date(2100, 11, 31))).toBe('1200')
  })
})

describe('pinFor', () => {
  it('derives MMYY from the period, not the clock', () => {
    expect(pinFor('2026-10', { mode: 'mmyy' })).toBe('1026')
    expect(pinFor('2027-01', { mode: 'mmyy' })).toBe('0127')
  })
  it('returns the custom PIN and rejects bad ones', () => {
    expect(pinFor('2026-10', { mode: 'custom', customPin: '4831' })).toBe('4831')
    expect(() => pinFor('2026-10', { mode: 'custom', customPin: '12a4' })).toThrow()
    expect(() => pinFor('2026-10', { mode: 'custom' })).toThrow()
  })
  it('needs the secret for secret mode', () => {
    expect(() => pinFor('2026-10', { mode: 'secret' })).toThrow()
  })
})

describe('secretPin', () => {
  const secret = Buffer.alloc(32, 7)
  it('is stable for a period and changes between periods', () => {
    const a = secretPin(secret, '2026-10')
    expect(a).toMatch(/^\d{4}$/)
    expect(secretPin(secret, '2026-10')).toBe(a)
    const months = new Set(Array.from({ length: 24 }, (_, i) => secretPin(secret, `20${26 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)))
    expect(months.size).toBeGreaterThan(20)
  })
  it('differs by secret', () => {
    expect(secretPin(Buffer.alloc(32, 1), '2026-10')).not.toBe(secretPin(Buffer.alloc(32, 2), '2026-10'))
  })
  it('is roughly uniform', () => {
    const counts = new Array(10).fill(0)
    for (let i = 0; i < 5000; i++) counts[Number(secretPin(secret, `p${i}`)[0])]++
    for (const c of counts) expect(c).toBeGreaterThan(380)
  })
  it('refuses short secrets', () => {
    expect(() => secretPin(Buffer.alloc(4), '2026-10')).toThrow()
  })
})

describe('adaptPin', () => {
  it('pads to five digits for Prime regions that need it', () => {
    expect(adaptPin('1026', 5)).toBe('01026')
    expect(adaptPin('1026', 4)).toBe('1026')
  })
})

describe('weakPinReason', () => {
  it('flags easy PINs', () => {
    expect(weakPinReason('1111')).not.toBeNull()
    expect(weakPinReason('1234')).not.toBeNull()
    expect(weakPinReason('9876')).not.toBeNull()
    expect(weakPinReason('1999')).not.toBeNull()
    expect(weakPinReason('123')).not.toBeNull()
  })
  it('accepts reasonable PINs', () => {
    expect(weakPinReason('4831')).toBeNull()
    expect(weakPinReason('1357')).toBeNull()
  })
})
