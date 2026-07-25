import { describe, it, expect } from 'vitest'
import { legDay } from './leg-day'

/**
 * These assertions only mean something when the process runs at a positive UTC offset — which is the
 * deployed reality (docker-compose pins `TZ: ${TZ:-Asia/Hong_Kong}`). At UTC+0 a wall-clock midnight
 * and its UTC instant are the same day and the bug cannot reproduce, so the offset-sensitive cases
 * are skipped rather than asserted into a false pass.
 */
const offsetMinutes = -new Date('2026-07-08T00:00:00').getTimezoneOffset()
const aheadOfUtc = offsetMinutes > 0

describe('legDay', () => {
  it('returns the wall-clock day the operator picked', () => {
    // Local midnight on the 8th, however the host zone renders it.
    expect(legDay(new Date(2026, 6, 8, 0, 0))).toBe('2026-07-08')
    expect(legDay(new Date(2026, 6, 8, 18, 30))).toBe('2026-07-08')
    expect(legDay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('pads month and day', () => {
    expect(legDay(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
  })

  const maybe = aheadOfUtc ? it : it.skip
  maybe('disagrees with the UTC slice exactly where the bug lived', () => {
    // A date-only leg value: the UI sends "2026-07-08T00:00", the backend mints local midnight.
    const legDate = new Date(2026, 6, 8, 0, 0)
    // Stored as UTC this lands on the PREVIOUS day — which is what alerts used to print.
    expect(legDate.toISOString().slice(0, 10)).toBe('2026-07-07')
    expect(legDay(legDate)).toBe('2026-07-08')
  })

  maybe('agrees with the UTC slice once the value carries a late-enough time', () => {
    // Past the offset, wall-clock day and UTC day coincide again — so the fix is not a blanket +1.
    const afternoon = new Date(2026, 6, 8, 23, 0)
    expect(afternoon.toISOString().slice(0, 10)).toBe('2026-07-08')
    expect(legDay(afternoon)).toBe('2026-07-08')
  })
})
