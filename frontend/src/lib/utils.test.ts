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
})
