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

  it("never shows db field names — John's exact case plus the long-tail fields", () => {
    expect(humanizeReason('backend conflict on qty, item_style_no, gross_weight, measurement')).toBe(
      'Emails disagree about: Qty, Item/Style, Gross Weight, Measurement — check the highlighted fields below',
    )
    const out = humanizeReason(
      'backend conflict on customer_po, customer_code, vendor_code, forwarder_name, pol, pod, flight_no, mawb, scac_code, hts_code, in_dc_date',
    )
    expect(out).not.toMatch(/_/)
    expect(out).toContain('PO#')
    expect(out).toContain('Port of Loading')
    expect(out).toContain('SCAC')
  })

  it('explains conflict counts, PO moves and mode changes', () => {
    expect(humanizeReason('3 unresolved field conflict(s)')).toMatch(/3 field\(s\) received different values/)
    expect(humanizeReason('a PO on this email currently belongs to a different shipment — moving/splitting a PO needs review')).toMatch(
      /already linked to another shipment/,
    )
    expect(humanizeReason('mode change SEA → AIR')).toMatch(/Transport mode changed SEA → AIR/)
  })

  it('explains a booked shipment with missing cargo (attachment likely not ingested)', () => {
    expect(
      humanizeReason('booked shipment missing cargo detail (qty/weight/volume) — source attachment likely not ingested'),
    ).toMatch(/Cargo quantity \/ weight \/ volume is missing/)
  })

  it('falls back to the raw string for unknown reasons', () => {
    expect(humanizeReason('some brand new reason')).toBe('some brand new reason')
  })
})
