import { describe, it, expect } from 'vitest'
import { emailKeyPinsThisLeg } from './email-key-pin'
import type { MatchAmbiguity } from './critic-review'

/**
 * The real payload from leg A84B3B1A / SO S13784413. The email stated HBL FCR001379073, the leg holds
 * exactly that, and none of the five offered candidates carries it — yet the desk asked "which
 * shipment?" and suggested a DIFFERENT leg (FCR001379050) whose vessel and ETD happened to match.
 */
const REAL: MatchAmbiguity = {
  kind: 'multi_candidate',
  emailKey: { so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379073', customer_po: 'B13756523' },
  sharedContainer: 'MRSU4743377',
  candidates: [
    { shipmentId: '1A6B6478', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378583' },
    { shipmentId: 'F18EA3A7', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378650', container_no: 'MRSU4743377' },
    { shipmentId: 'B1F99BCB', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379050', container_no: 'TCNU5114660' },
    { shipmentId: 'F0772AAC', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001380008' },
    { shipmentId: '541CFCEF', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378656', container_no: 'MRSU4743377' },
  ],
}

const REAL_LEG = { hblNumber: 'FCR001379073', soNumber: 'S13784413' }

describe('emailKeyPinsThisLeg', () => {
  it('the email HBL names this leg and no candidate shares it → pinned', () => {
    expect(emailKeyPinsThisLeg(REAL, REAL_LEG)).toEqual({ label: 'HBL', value: 'FCR001379073' })
  })

  it('case and padding do not break the match', () => {
    expect(emailKeyPinsThisLeg(REAL, { hblNumber: '  fcr001379073 ' })?.value).toBe('FCR001379073')
  })

  /**
   * so_no is the key that CAUSED the false ambiguity — every leg of one order shares it — and a 拼櫃
   * container is shared by definition. Neither may pin anything.
   */
  it('a shared SO never pins, even when the leg carries it', () => {
    const soOnly: MatchAmbiguity = { ...REAL, emailKey: { so_no: 'S13784413' } }
    expect(emailKeyPinsThisLeg(soOnly, REAL_LEG)).toBeNull()
  })

  it('a shared container never pins', () => {
    const ctr: MatchAmbiguity = { ...REAL, emailKey: { container_no: 'MRSU4743377' } }
    expect(emailKeyPinsThisLeg(ctr, { containerNo: 'MRSU4743377' })).toBeNull()
  })

  it('a candidate carrying the same key means there IS a choice — no pin', () => {
    const contested: MatchAmbiguity = {
      ...REAL,
      candidates: [...REAL.candidates, { shipmentId: 'OTHER', hbl_awb_fcr_no: 'FCR001379073' }],
    }
    expect(emailKeyPinsThisLeg(contested, REAL_LEG)).toBeNull()
  })

  it('the leg holding a different HBL is not pinned — it is the real ambiguity', () => {
    expect(emailKeyPinsThisLeg(REAL, { hblNumber: 'FCR001378583' })).toBeNull()
  })

  it('falls back through the key ladder: MBL, then booking no.', () => {
    const byBooking: MatchAmbiguity = {
      emailKey: { booking_no: 'BK-9' },
      candidates: [{ shipmentId: 'X', booking_no: 'BK-8' }],
    }
    expect(emailKeyPinsThisLeg(byBooking, { bookingNo: 'BK-9' })).toEqual({
      label: 'booking no.',
      value: 'BK-9',
    })
  })

  it('missing payload, missing key, or a leg without the column → no pin', () => {
    expect(emailKeyPinsThisLeg(null, REAL_LEG)).toBeNull()
    expect(emailKeyPinsThisLeg(REAL, null)).toBeNull()
    expect(emailKeyPinsThisLeg({ candidates: [] }, REAL_LEG)).toBeNull()
    expect(emailKeyPinsThisLeg(REAL, {})).toBeNull()
    expect(emailKeyPinsThisLeg(REAL, { hblNumber: '' })).toBeNull()
  })
})

/**
 * Leg 5F8C0334: the email said booking `#TN#1075317470#BKG`, the leg holds `TN#1075317470#BKG`.
 * The same booking, one stray leading `#` off a label — and it was enough to keep a five-way picker
 * on screen.
 */
describe('edge punctuation does not hide a match', () => {
  const amb = {
    emailKey: { booking_no: '#TN#1075317470#BKG' },
    candidates: [
      { shipmentId: 'A', booking_no: 'TN1075317470' },
      { shipmentId: 'B', booking_no: '1075317470' },
    ],
  }

  it('pins through a leading label character', () => {
    expect(emailKeyPinsThisLeg(amb, { bookingNo: 'TN#1075317470#BKG' })).toEqual({
      label: 'booking no.',
      value: '#TN#1075317470#BKG',
    })
  })

  /** Separators INSIDE the value are load-bearing — only the edges are trimmed. */
  it('does not collapse two genuinely different bookings', () => {
    expect(emailKeyPinsThisLeg(amb, { bookingNo: 'TN1075317470BKG' })).toBeNull()
    expect(
      emailKeyPinsThisLeg({ emailKey: { booking_no: 'AB#12' }, candidates: [] }, { bookingNo: 'AB#13' }),
    ).toBeNull()
  })
})
