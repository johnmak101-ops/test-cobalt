import { describe, it, expect } from 'vitest'
import { conflictingKey, reconcileQueueCandidates } from './candidate-reconcile'

/**
 * The real payload from leg A84B3B1A / SO S13784413. One sales order, eleven house bills — normal
 * freight — and the queue offered every sibling as somewhere this email might belong.
 */
const EMAIL_KEY = { so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379073' }
const OFFERED = [
  { shipmentId: '1A6B6478', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378583' },
  { shipmentId: 'F18EA3A7', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378650', container_no: 'MRSU4743377' },
  { shipmentId: 'B1F99BCB', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379050', container_no: 'TCNU5114660' },
  { shipmentId: 'F0772AAC', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001380008' },
]

describe('conflictingKey — the committer’s own refusal rule', () => {
  it('a different B/L is a different shipment', () => {
    expect(conflictingKey(EMAIL_KEY, OFFERED[0]!)).toBe('hbl_awb_fcr_no')
  })

  it('the same SO is not a conflict — one order carries many house bills', () => {
    expect(conflictingKey({ so_no: 'S13784413' }, { shipmentId: 'x', so_no: 'S13784413' })).toBeNull()
  })

  it('a key only one side states cannot clash', () => {
    expect(conflictingKey({ hbl_awb_fcr_no: 'H1' }, { shipmentId: 'x', so_no: 'S1' })).toBeNull()
    expect(conflictingKey({}, { shipmentId: 'x', hbl_awb_fcr_no: 'H1' })).toBeNull()
  })

  it('reports the first clashing type, whichever it is', () => {
    expect(conflictingKey({ booking_no: 'BK-9' }, { shipmentId: 'x', booking_no: 'BK-8' })).toBe('booking_no')
    expect(conflictingKey({ container_no: 'C1' }, { shipmentId: 'x', container_no: 'C2' })).toBe('container_no')
  })

  /** Normalisation is the committer's, so formatting differences are not treated as disagreement. */
  it('does not invent a conflict from formatting', () => {
    expect(conflictingKey({ hbl_awb_fcr_no: 'fcr001379073' }, { shipmentId: 'x', hbl_awb_fcr_no: 'FCR001379073' })).toBeNull()
  })
})

describe('reconcileQueueCandidates', () => {
  it('refuses every sibling that states a different B/L, and says why', () => {
    const r = reconcileQueueCandidates(EMAIL_KEY, OFFERED)
    expect(r.usable).toEqual([])
    expect(r.refused.map((x) => x.shipmentId)).toEqual(['1A6B6478', 'F18EA3A7', 'B1F99BCB', 'F0772AAC'])
    expect(r.refused[0]).toMatchObject({
      onKey: 'hbl_awb_fcr_no',
      emailValue: 'FCR001379073',
      candidateValue: 'FCR001378583',
    })
  })

  it('keeps a candidate that can coexist with the email', () => {
    const r = reconcileQueueCandidates(EMAIL_KEY, [
      ...OFFERED,
      // Same B/L as the email → not ruled out. This is a genuine "did we duplicate?" candidate.
      { shipmentId: 'SAME', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379073' },
      // States nothing comparable → absence is not a conflict.
      { shipmentId: 'THIN', so_no: 'S13784413' },
    ])
    expect(r.usable).toEqual(['SAME', 'THIN'])
    expect(r.refused).toHaveLength(4)
  })

  it('no email key → nothing can be ruled out, so nothing is', () => {
    const r = reconcileQueueCandidates(null, OFFERED)
    expect(r.usable).toHaveLength(4)
    expect(r.refused).toEqual([])
  })

  it('empty input is inert', () => {
    expect(reconcileQueueCandidates(EMAIL_KEY, [])).toEqual({ usable: [], refused: [] })
    expect(reconcileQueueCandidates(EMAIL_KEY, null)).toEqual({ usable: [], refused: [] })
  })

  /**
   * The trap #378 fell into: settling identity by comparing the email's key to the leg's OWN key is
   * circular, because a leg the committer created carries that key by construction. This function only
   * ever looks at other legs, so it cannot repeat it — it removes the impossible, never picks a winner.
   */
  it('never nominates a winner — it only removes the impossible', () => {
    const r = reconcileQueueCandidates(EMAIL_KEY, [{ shipmentId: 'SAME', hbl_awb_fcr_no: 'FCR001379073' }])
    expect(r.usable).toEqual(['SAME'])
    expect(r.refused).toEqual([])
  })
})
