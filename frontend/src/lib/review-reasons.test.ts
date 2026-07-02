import { describe, it, expect } from 'vitest'
import { humanizeReason } from './review-reasons'

describe('humanizeReason — engineering audit strings → ops language', () => {
  it('translates the two "bad example" warnings John flagged', () => {
    expect(humanizeReason('PO-linked group with an identity supersede (possible over-merge of two shipments)')).toMatch(
      /ONE shipment, not two merged by mistake/,
    )
    expect(humanizeReason('≥2 distinct co-current values of one strong-id type — multi-booking/SO group needs review')).toMatch(
      /more than one active booking\/SO number/,
    )
  })

  it('names the disputed fields in plain words', () => {
    expect(humanizeReason('backend conflict on qty, gross_weight, measurement')).toBe(
      'Emails disagree about: Qty, Gross Weight, Measurement — check the highlighted fields below',
    )
  })

  it('explains conflict counts, PO moves and mode changes', () => {
    expect(humanizeReason('3 unresolved field conflict(s)')).toMatch(/3 field\(s\) received different values/)
    expect(humanizeReason('a PO on this email currently belongs to a different shipment — moving/splitting a PO needs review')).toMatch(
      /already linked to another shipment/,
    )
    expect(humanizeReason('mode change SEA → AIR')).toMatch(/Transport mode changed SEA → AIR/)
  })

  it('falls back to the raw string for unknown reasons', () => {
    expect(humanizeReason('some brand new reason')).toBe('some brand new reason')
  })
})
