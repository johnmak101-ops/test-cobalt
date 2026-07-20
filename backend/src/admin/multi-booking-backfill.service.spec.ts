import { describe, expect, it } from 'vitest'
import {
  BACKFILL_STAMP_REASON,
  detectMultiBookingMushSignals,
} from './multi-booking-backfill.signals'

describe('detectMultiBookingMushSignals', () => {
  it('flags co-current multi-id reasons', () => {
    const s = detectMultiBookingMushSignals({
      reviewReasons: ['≥2 distinct co-current values of one strong-id type — multi-booking/SO group needs review'],
      bookingNo: 'BK1',
      criticReview: null,
    })
    expect(s).toContain('review_reason')
  })

  it('flags incomplete split reason', () => {
    const s = detectMultiBookingMushSignals({
      reviewReasons: ['Multi-booking split incomplete — expected 3 bookings, produced 2'],
      bookingNo: null,
      criticReview: null,
    })
    expect(s).toContain('review_reason')
  })

  it('flags concatenated booking_no', () => {
    const s = detectMultiBookingMushSignals({
      reviewReasons: [],
      bookingNo: 'BK14568, BK14570 & BK14571',
      criticReview: null,
    })
    expect(s).toContain('concat_booking_no')
  })

  it('flags splitAudit and matchAmbiguity on critic', () => {
    const s = detectMultiBookingMushSignals({
      reviewReasons: [],
      bookingNo: 'BK1',
      criticReview: {
        splitAudit: { expected: 3, actual: 2 },
        matchAmbiguity: { candidates: [{}, {}] },
      },
    })
    expect(s).toContain('split_audit')
    expect(s).toContain('match_ambiguity')
  })

  it('detects already stamped', () => {
    const s = detectMultiBookingMushSignals({
      reviewReasons: [BACKFILL_STAMP_REASON],
      bookingNo: null,
      criticReview: null,
    })
    expect(s).toContain('already_stamped')
  })
})
