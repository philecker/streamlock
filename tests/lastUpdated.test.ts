import { describe, expect, it } from 'vitest'
import { lastUpdated } from '../src/renderer/src/format'

describe('lastUpdated', () => {
  it('formats MM/DD/YYYY in local time with leading zeros', () => {
    expect(lastUpdated(new Date(2026, 9, 1, 9, 4).toISOString())).toBe('10/01/2026')
    expect(lastUpdated(new Date(2027, 0, 5, 23, 59).toISOString())).toBe('01/05/2027')
  })
  it('says Never when the PIN was not set yet', () => {
    expect(lastUpdated(undefined)).toBe('Never')
    expect(lastUpdated('garbage')).toBe('Never')
  })
})
