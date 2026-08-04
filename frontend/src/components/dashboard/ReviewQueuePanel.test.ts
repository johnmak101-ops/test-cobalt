import { describe, it, expect } from 'vitest'
import { primaryReason } from './ReviewQueuePanel'

const row = (over: Partial<Parameters<typeof primaryReason>[0]> = {}) => ({
  reviewReasons: [],
  openDecisions: null,
  route: null,
  poCount: 0,
  ...over,
}) as Parameters<typeof primaryReason>[0]

/**
 * The review row's answer to an alert's `message`. Without it the card shows an identifier and
 * nothing else, and the operator has to open the leg to find out why it is on the desk at all —
 * which is the difference the dashboard exists to save them.
 *
 * Every case here is a way the old one-liner (`humanizeReason(reviewReasons[0])`) disagreed with the
 * desk it links to.
 */
describe('primaryReason', () => {
  it('humanizes the first operator-facing reason', () => {
    const out = primaryReason(row({ reviewReasons: ['matched multiple backend legs (ambiguous)'] }))
    expect(out).toBeTruthy()
    // Humanized, not the raw pipeline string.
    expect(out).not.toBe('matched multiple backend legs (ambiguous)')
  })

  /** Ops-internal chatter exists for the pipeline's own audit trail. Leading a card with one tells
   *  the operator nothing about what to do, so it must never win the single line on offer. */
  it('skips silent ops lines in favour of a real reason', () => {
    const out = primaryReason(row({
      reviewReasons: [
        "auto: subject-party-pin: vendor_code kept 'ROKNFT' over 'SOUOCE'",
        'matched multiple backend legs (ambiguous)',
      ],
    }))
    expect(out).toBeTruthy()
    expect(out).not.toMatch(/subject-party-pin/i)
  })

  it('returns null when there is nothing worth showing — the caller has a fallback', () => {
    expect(primaryReason(row())).toBeNull()
    expect(primaryReason(row({ reviewReasons: undefined }))).toBeNull()
    expect(primaryReason(row({ reviewReasons: ['   '] }))).toBeNull()
    expect(primaryReason(row({
      reviewReasons: ["auto: subject-party-pin: vendor_code kept 'X' over 'Y'"],
    }))).toBeNull()
  })

  /**
   * Leg 202601556A shipped this to the dashboard verbatim, clamped mid-word at "out of b", while the
   * review desk classified the very same string as FYI and showed it nowhere. An unmapped queue audit
   * line is not an instruction to anyone on this floor.
   */
  it('never leads with a pipeline audit string the desk itself hides', () => {
    const out = primaryReason(row({
      reviewReasons: ["identity-dispose: demoted 进仓-labelled 'GZL26258522' out of booking_no"],
    }))
    expect(out).toBeNull()
  })

  /**
   * The gate counted nine conflicts before the committer ran; the commit then settled seven of them.
   * The row states the two the table will actually show, and names them.
   */
  it('names the OPEN conflict fields instead of repeating the gate\'s pre-commit count', () => {
    const out = primaryReason(row({
      reviewReasons: ['9 field conflict(s)'],
      openDecisions: {
        settledFields: ['qty', 'voyage_no', 'consignee_name', 'consignee_address', 'mbl', 'eta', 'atd'],
        openFields: ['etd', 'vessel_name'],
        resolvedParties: [],
      },
    }))
    expect(out).toBe('Emails disagree about: ETD, Vessel — open to compare')
    expect(out).not.toMatch(/9 field/)
  })

  it('caps the named fields so the line stays a sentence', () => {
    const out = primaryReason(row({
      reviewReasons: ['5 field conflict(s)'],
      openDecisions: {
        settledFields: [],
        openFields: ['etd', 'vessel_name', 'voyage_no', 'mbl', 'container_no'],
        resolvedParties: [],
      },
    }))
    expect(out).toBe('Emails disagree about: ETD, Vessel, Voyage +2 more — open to compare')
  })

  /** Every flagged value already matches the leg: there is nothing to compare, so the count must not
   *  come back as prose either (auto-clear takes these off the Active desk for the same reason). */
  it('says nothing about fields when the commit settled all of them', () => {
    const out = primaryReason(row({
      reviewReasons: ['3 field conflict(s)'],
      openDecisions: {
        settledFields: ['etd', 'vessel_name', 'voyage_no'],
        openFields: [],
        resolvedParties: [],
      },
    }))
    expect(out).toBeNull()
  })

  /** Identity outranks the grid, exactly as it does in the card's headline: applying values to the
   *  wrong leg is worse than leaving them unapplied. */
  it('asks which shipment before it asks which values', () => {
    const out = primaryReason(row({
      reviewReasons: ['matched multiple backend legs (ambiguous)', '2 field conflict(s)'],
      openDecisions: { settledFields: [], openFields: ['etd'], resolvedParties: [] },
    }))
    expect(out).toMatch(/more than one existing shipment/i)
  })

  /** A miss line that outlived its resolution is dropped here as it is on the card (PartiesLinked). */
  it('drops a party miss the leg has since resolved', () => {
    const out = primaryReason(row({
      reviewReasons: ['Cannot match "SOUTH OCEAN KNITTERS LIMITED" in the forwarder list'],
      openDecisions: {
        settledFields: [],
        openFields: [],
        resolvedParties: [{ slot: 'vendor', name: 'SOUTH OCEAN KNITTERS LTD' }],
      },
    }))
    expect(out).toBeNull()
  })
})
