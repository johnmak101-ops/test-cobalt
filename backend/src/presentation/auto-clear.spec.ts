import { describe, it, expect } from 'vitest'
import { autoClearVerdict } from './auto-clear'
import type { CriticReview } from '../decisions/critic-review.types'

const conflict = (field: string, system: string, offered: string) => ({
  field,
  label: field,
  candidates: [
    { value: system, source: 'System' },
    { value: offered, source: 'Draft B/L' },
  ],
  rationale: 'x',
})

const review = (...conflicts: ReturnType<typeof conflict>[]) =>
  ({ conflicts } as unknown as CriticReview)

describe('autoClearVerdict — legs whose only control would be Confirm Reviewed', () => {
  it('clears when the one flagged value already matches the leg', () => {
    const v = autoClearVerdict(
      { vesselName: 'MARIBO MAERSK' },
      review(conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK')),
      ['1 field conflict(s)'],
    )
    expect(v.clear).toBe(true)
    expect(v).toHaveProperty('why', 'the one flagged value already matches the shipment')
  })

  it('keeps the leg when a flagged value still differs', () => {
    const v = autoClearVerdict(
      { vesselName: 'SOMETHING ELSE' },
      review(conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK')),
      ['1 field conflict(s)'],
    )
    expect(v.clear).toBe(false)
  })

  it('keeps the leg when only SOME conflicts are settled', () => {
    const v = autoClearVerdict(
      { vesselName: 'MARIBO MAERSK', voyageNo: '999X' },
      review(
        conflict('vessel_name', 'X', 'MARIBO MAERSK'),
        conflict('voyage_no', 'X', '631W'),
      ),
      ['2 field conflict(s)'],
    )
    expect(v.clear).toBe(false)
  })

  /**
   * The safety property: every test is a reason to CLEAR, so anything unrecognised keeps the leg
   * visible. A leg wrongly shown costs one click; a leg wrongly hidden is a shipment nobody checked.
   */
  it('keeps the leg when any reason is about something other than the conflict table', () => {
    const settled = { vesselName: 'MARIBO MAERSK' }
    const r = review(conflict('vessel_name', 'X', 'MARIBO MAERSK'))
    for (const reason of [
      'Cannot match "South Ocean" in the vendor list',
      'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment',
      'a PO on this email currently belongs to a different shipment',
      'vision_pending',
      'some brand new reason nobody has classified yet',
    ]) {
      expect(autoClearVerdict(settled, r, ['1 field conflict(s)', reason]).clear).toBe(false)
    }
  })

  it('clears a leg with no conflicts and no reasons at all', () => {
    expect(autoClearVerdict({}, null, []).clear).toBe(true)
  })

  it('does not clear a leg with no conflicts but a real reason', () => {
    expect(autoClearVerdict({}, null, ['missing cargo detail']).clear).toBe(false)
  })

  it('ignores audit-only reasons the desk never shows', () => {
    expect(autoClearVerdict({}, null, ['subject-party-pin', 'identity_fallback']).clear).toBe(true)
  })

  /** Settled conflict rows do not answer "which of these shipments is it?". */
  it('keeps a leg that is still offering a candidate picker', () => {
    const withCandidates = {
      conflicts: [conflict('vessel_name', 'X', 'MARIBO MAERSK')],
      matchAmbiguity: { candidates: [{ shipmentId: 'a' }, { shipmentId: 'b' }] },
    } as unknown as CriticReview
    expect(
      autoClearVerdict({ vesselName: 'MARIBO MAERSK' }, withCandidates, ['1 field conflict(s)']).clear,
    ).toBe(false)
  })

  it('names how many values matched, for the cleared-group strip', () => {
    const v = autoClearVerdict(
      { vesselName: 'MARIBO MAERSK', voyageNo: '631W' },
      review(conflict('vessel_name', 'X', 'MARIBO MAERSK'), conflict('voyage_no', 'X', '631W')),
      ['2 field conflict(s)'],
    )
    expect(v).toHaveProperty('why', 'all 2 flagged values already match the shipment')
  })
})
