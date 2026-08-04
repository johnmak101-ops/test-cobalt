import { describe, it, expect } from 'vitest'
import { queueLearningValue } from './queue-field-value'

/**
 * Same rule as leg-day.spec: the offset-sensitive cases only mean something at a positive UTC offset,
 * which is the deployed reality (docker-compose pins `TZ: ${TZ:-Asia/Hong_Kong}`). At UTC+0 the bug
 * cannot reproduce, so they are skipped rather than asserted into a false pass. Everything else is
 * written with LOCAL Date constructors, which behave identically in every zone.
 */
const aheadOfUtc = -new Date('2026-05-08T00:00:00').getTimezoneOffset() > 0
const maybe = aheadOfUtc ? it : it.skip

describe('queueLearningValue — what the queue learning feed receives', () => {
  it('formats a leg date as the parser does (YYYY-MM-DD), not as an ISO instant', () => {
    // The regression: toStr gave 2026-05-08T00:00:00.000Z, which no re-parse can ever produce, so the
    // correction scored as a miss for both souls forever.
    const d = new Date(2026, 4, 8, 0, 0, 0) // local wall-clock 2026-05-08
    expect(queueLearningValue('etd', d)).toBe('2026-05-08')
    expect(queueLearningValue('cargoReadyDate', d)).toBe('2026-05-08')
  })

  maybe('uses the LOCAL day exactly where a UTC slice would slide back one', () => {
    // Leg dates are naive local wall-clock stored as UTC, so the ISO slice returns the PREVIOUS day.
    const legDate = new Date(2026, 4, 8, 0, 0)
    expect(legDate.toISOString().slice(0, 10)).toBe('2026-05-07')
    expect(queueLearningValue('etd', legDate)).toBe('2026-05-08')
  })

  it('keeps day granularity for the timed columns — the parser has no finer form to compare against', () => {
    expect(queueLearningValue('warehouseEndDate', new Date(2026, 3, 24, 14, 30))).toBe('2026-04-24')
    expect(queueLearningValue('cfsCutoff', new Date(2026, 3, 24, 14, 30))).toBe('2026-04-24')
  })

  it('accepts an ISO string on a date column (the DTO may not be coerced yet)', () => {
    // No zone suffix → parsed as LOCAL wall-clock, which is what the UI sends and what the column holds.
    expect(queueLearningValue('atd', '2026-05-08T00:00:00')).toBe('2026-05-08')
  })

  it('passes non-date columns through as text', () => {
    expect(queueLearningValue('bookingNo', 'SE3006260293')).toBe('SE3006260293')
    expect(queueLearningValue('qty', 4760)).toBe('4760')
  })

  it('treats null and blank as nothing to say', () => {
    expect(queueLearningValue('etd', null)).toBeNull()
    expect(queueLearningValue('etd', '')).toBeNull()
    expect(queueLearningValue('bookingNo', undefined)).toBeNull()
  })

  it('refuses to invent a date from junk', () => {
    expect(queueLearningValue('etd', 'not a date')).toBeNull()
  })

  it('day-formats a stray Date even on a column not in DATE_FIELDS (never an ISO instant)', () => {
    expect(queueLearningValue('bookingNo', new Date(2026, 4, 8))).toBe('2026-05-08')
  })
})
