import { describe, it, expect } from 'vitest'
import { finalDocumentReceived, legIsAlertEligible } from './alert-evaluator.service'

const settledConflict = {
  conflicts: [
    {
      field: 'vessel_name',
      label: 'vessel_name',
      candidates: [
        { value: 'MAASTRICHT MAERSK', source: 'System' },
        { value: 'MARIBO MAERSK', source: 'Draft B/L' },
      ],
      rationale: 'x',
    },
  ],
}

describe('legIsAlertEligible — auto-cleared legs get alerts too', () => {
  it('a confirmed leg is always eligible', () => {
    expect(legIsAlertEligible({ reviewStatus: 'confirmed' })).toBe(true)
  })

  /**
   * The gap this closes: an auto-cleared leg is deliberately never written to `confirmed` (so a later
   * email can bring it back to the desk), which left it provisional forever — and alerts skipped it.
   * A shipment nobody had to review was also a shipment nobody would be warned about.
   */
  it('a provisional leg the desk auto-cleared is eligible', () => {
    expect(
      legIsAlertEligible({
        reviewStatus: 'provisional',
        vesselName: 'MARIBO MAERSK', // the flagged value already matches → nothing left to decide
        criticReview: settledConflict,
        reviewReasons: ['1 field conflict(s)'],
      }),
    ).toBe(true)
  })

  it('a provisional leg still awaiting a human is NOT eligible', () => {
    expect(
      legIsAlertEligible({
        reviewStatus: 'provisional',
        vesselName: 'SOMETHING ELSE', // still disagrees → a real question
        criticReview: settledConflict,
        reviewReasons: ['1 field conflict(s)'],
      }),
    ).toBe(false)
  })

  it('an unrecognised reason keeps the leg out — automation never acts on unreviewed data', () => {
    expect(
      legIsAlertEligible({
        reviewStatus: 'provisional',
        vesselName: 'MARIBO MAERSK',
        criticReview: settledConflict,
        reviewReasons: ['1 field conflict(s)', 'Cannot match "South Ocean" in the vendor list'],
      }),
    ).toBe(false)
  })

  it('tolerates a reviewReasons column stored as a single string', () => {
    expect(
      legIsAlertEligible({ reviewStatus: 'provisional', reviewReasons: 'missing cargo detail' }),
    ).toBe(false)
  })

  it('a bare provisional leg with nothing flagged is eligible', () => {
    expect(legIsAlertEligible({ reviewStatus: 'provisional' })).toBe(true)
  })

  it('does not throw on junk input', () => {
    expect(legIsAlertEligible(null)).toBe(true) // no reasons, no conflicts — nothing to hold it back
    expect(legIsAlertEligible(undefined)).toBe(true)
  })
})

/**
 * The air-freight half of the false "No Final B/L" banner on 202601256B — see finalDocumentReceived.
 */
describe('finalDocumentReceived — the AWB is the air leg final document', () => {
  it('an AIR leg holding an MAWB has its final document, milestone or not', () => {
    expect(finalDocumentReceived({ mode: 'AIR', mawb: '098-32230085' }, null)).toBe(true)
  })

  it('an AIR leg with no MAWB is still chased', () => {
    expect(finalDocumentReceived({ mode: 'AIR', mawb: null }, null)).toBe(false)
    expect(finalDocumentReceived({ mode: 'AIR', mawb: '   ' }, null)).toBe(false)
  })

  /** The regression guard: a house B/L number exists from DRAFT stage, so it can never stand in. */
  it('a SEA leg is chased until the milestone lands — an MAWB column cannot answer for it', () => {
    expect(finalDocumentReceived({ mode: 'SEA', mawb: '098-32230085' }, null)).toBe(false)
    expect(finalDocumentReceived({ mode: 'SEA', mawb: null }, new Date('2026-02-05'))).toBe(true)
  })
})
