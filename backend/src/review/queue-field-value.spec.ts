import { describe, it, expect } from 'vitest'
import { queueLearningValue } from './queue-field-value'

describe('queueLearningValue — what the queue learning feed receives', () => {
  it('formats a leg date as the parser does (YYYY-MM-DD), not as an ISO instant', () => {
    // The regression: toStr gave 2026-05-08T00:00:00.000Z, which no re-parse can ever produce, so the
    // correction scored as a miss for both souls forever.
    const d = new Date(2026, 4, 8, 0, 0, 0) // local wall-clock 2026-05-08
    expect(queueLearningValue('etd', d)).toBe('2026-05-08')
    expect(queueLearningValue('cargoReadyDate', d)).toBe('2026-05-08')
  })

  it('uses the LOCAL day, so an east-of-Greenwich instant does not slide to the previous date', () => {
    // Leg dates are naive local wall-clock stored as UTC; slicing the ISO string returns the day before.
    const d = new Date(2026, 4, 8, 0, 30, 0)
    expect(queueLearningValue('etd', d)).toBe('2026-05-08')
    expect(d.toISOString().slice(0, 10) === '2026-05-08').toBe(process.env.TZ === 'UTC')
  })

  it('keeps day granularity for the timed columns — the parser has no finer form to compare against', () => {
    expect(queueLearningValue('warehouseEndDate', new Date(2026, 3, 24, 14, 30))).toBe('2026-04-24')
    expect(queueLearningValue('cfsCutoff', new Date(2026, 3, 24, 14, 30))).toBe('2026-04-24')
  })

  it('accepts an ISO string on a date column (the DTO may not be coerced yet)', () => {
    expect(queueLearningValue('atd', '2026-05-08T00:00:00.000+08:00')).toBe('2026-05-08')
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
