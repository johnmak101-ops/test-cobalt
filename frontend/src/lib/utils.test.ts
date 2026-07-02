import { describe, it, expect } from 'vitest'
import { formatDateMaybeTime } from './utils'

describe('formatDateMaybeTime — cut-off deadlines show their stated time', () => {
  it('shows date + HH:mm when a wall-clock time was stated (截仓时间 15:00)', () => {
    // constructed in LOCAL time on purpose — the DB stores 15:00 local as timestamptz
    expect(formatDateMaybeTime(new Date(2026, 5, 29, 15, 0))).toBe('29 Jun 2026 15:00')
  })

  it('stays date-only for plain dates (local midnight)', () => {
    expect(formatDateMaybeTime(new Date(2026, 6, 5, 0, 0))).toBe('5 Jul 2026')
  })

  it('renders TBD for null', () => {
    expect(formatDateMaybeTime(null)).toBe('TBD')
  })

  it('treats UTC-midnight instants as date-only — parser dates without time land at 00:00Z and must NOT invent "08:00"', () => {
    // "2026-06-28" parsed by new Date() = 2026-06-28T00:00:00Z = 08:00 HKT; the 08:00 was never stated
    expect(formatDateMaybeTime('2026-06-28T00:00:00.000Z')).toBe('28 Jun 2026')
    expect(formatDateMaybeTime('2026-07-27T00:00:00.000Z')).toBe('27 Jul 2026')
  })

  it('a real stated time that is not UTC midnight still shows (12:00 local cut-off)', () => {
    expect(formatDateMaybeTime(new Date(2026, 5, 27, 12, 0))).toBe('27 Jun 2026 12:00')
  })
})
