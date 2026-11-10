import { describe, expect, it } from 'vitest'
import { activePeriod, changeTime, isPending, nextChangeAt, nextPeriod, periodOf, shouldNoticeDayBefore } from '../src/main/schedule'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('periods', () => {
  it('formats and advances, including across the year', () => {
    expect(periodOf(at(2026, 10, 20))).toBe('2026-10')
    expect(nextPeriod('2026-10')).toBe('2026-11')
    expect(nextPeriod('2026-12')).toBe('2027-01')
  })
  it('change time is the 1st at the configured hour', () => {
    expect(changeTime('2026-11', 9).getTime()).toBe(at(2026, 11, 1, 9).getTime())
  })
})

describe('activePeriod', () => {
  it('keeps last month until the change hour on the 1st', () => {
    expect(activePeriod(at(2026, 11, 1, 8, 59), 9)).toBe('2026-10')
    expect(activePeriod(at(2026, 11, 1, 9, 0), 9)).toBe('2026-11')
    expect(activePeriod(at(2027, 1, 1, 3), 9)).toBe('2026-12')
  })
})

describe('nextChangeAt', () => {
  it('points at the next 1st', () => {
    expect(nextChangeAt(at(2026, 10, 20), 9).getTime()).toBe(at(2026, 11, 1, 9).getTime())
    expect(nextChangeAt(at(2026, 11, 1, 8), 9).getTime()).toBe(at(2026, 11, 1, 9).getTime())
    expect(nextChangeAt(at(2026, 12, 15), 9).getTime()).toBe(at(2027, 1, 1, 9).getTime())
  })
})

describe('isPending', () => {
  it('never fires for a login that was never applied', () => {
    expect(isPending(undefined, at(2026, 11, 2), 9)).toBe(false)
  })
  it('fires once the month turns over', () => {
    expect(isPending('2026-10', at(2026, 10, 31), 9)).toBe(false)
    expect(isPending('2026-10', at(2026, 11, 1, 9, 1), 9)).toBe(true)
    expect(isPending('2026-11', at(2026, 11, 1, 9, 1), 9)).toBe(false)
  })
  it('catches up after the Mac was off for weeks', () => {
    expect(isPending('2026-08', at(2026, 11, 20), 9)).toBe(true)
  })
})

describe('shouldNoticeDayBefore', () => {
  it('fires from the change hour the day before, once per period', () => {
    expect(shouldNoticeDayBefore(at(2026, 10, 30, 9), 9, undefined)).toBe(false)
    expect(shouldNoticeDayBefore(at(2026, 10, 31, 8, 59), 9, undefined)).toBe(false)
    // Oct 31 -> Nov 1, 2026 crosses the US DST change; must still fire at 9:00.
    expect(shouldNoticeDayBefore(at(2026, 10, 31, 9, 0), 9, undefined)).toBe(true)
    expect(shouldNoticeDayBefore(at(2026, 10, 31, 9, 1), 9, '2026-11')).toBe(false)
  })
  it('handles month ends of different lengths', () => {
    expect(shouldNoticeDayBefore(at(2027, 2, 28, 9), 9, undefined)).toBe(true)
    expect(shouldNoticeDayBefore(at(2027, 2, 27, 23), 9, undefined)).toBe(false)
  })
})
