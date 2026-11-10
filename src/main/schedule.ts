// Pure date logic for the monthly change. All times are the user's local time.

/** 'YYYY-MM' for the local month containing `date`. */
export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return periodOf(new Date(y, m, 1)) // month index m == next month
}

/** Moment the given period's PIN takes effect: the 1st at `hour`:00 local. */
export function changeTime(period: string, hour: number): Date {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1, hour, 0, 0, 0)
}

/** The PIN period in force at `now` (before the change hour on the 1st, last month's). */
export function activePeriod(now: Date, hour: number): string {
  const p = periodOf(now)
  return now >= changeTime(p, hour) ? p : periodOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

export function nextChangeAt(now: Date, hour: number): Date {
  return changeTime(nextPeriod(activePeriod(now, hour)), hour)
}

/**
 * A service is pending when it has been set up before (has a lastAppliedPeriod)
 * but not for the active period. A brand-new login is applied by hand first, so
 * installing mid-month never triggers a surprise run.
 */
export function isPending(lastAppliedPeriod: string | undefined, now: Date, hour: number): boolean {
  return lastAppliedPeriod !== undefined && lastAppliedPeriod !== activePeriod(now, hour)
}

/**
 * True from the change hour on the day before the next change, once per period.
 * Uses calendar arithmetic rather than "24 hours" so a DST switch (US clocks
 * fall back on Nov 1, 2026) cannot shift the notice by an hour.
 */
export function shouldNoticeDayBefore(now: Date, hour: number, lastNoticePeriod: string | undefined): boolean {
  const next = nextChangeAt(now, hour)
  const upcoming = periodOf(next)
  const noticeAt = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1, hour, 0, 0, 0)
  return lastNoticePeriod !== upcoming && now >= noticeAt
}
