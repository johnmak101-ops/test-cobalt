import { describe, it, expect } from 'vitest'
import { humanizeReason, humanizeReasons } from './review-reasons'

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

  it('humanizes the queue stale-ETD note (produced by cobalt-queue validate.ts)', () => {
    // Producer: cobalt-queue src/parser/validate.ts emits this note; it reaches ShipTrack as a
    // review_reason (truncated ~60 chars in decision.ts) and is rendered here. ShipTrack's own
    // committer flag for this was retired to dedupe — the queue owns stale-ETD detection.
    expect(
      humanizeReason('ETD 2026-01-24 is 156 days before this email (2026-06-29) — likely wrong month or stale subject (sender) — verify'),
    ).toBe('ETD 2026-01-24 is 156 days before this email')
  })

  it('humanizes attachment-missing and master/port unmatched reasons without DB field names', () => {
    expect(humanizeReason('email references an attachment but none was ingested — original booking file missing')).toBe(
      'Referenced attachment is missing from this thread — data may be incomplete',
    )
    expect(
      humanizeReason(
        'referenced attachment not present on this thread — packing list or cargo detail may be incomplete',
      ),
    ).toBe('Referenced attachment is missing from this thread — data may be incomplete')
    expect(
      humanizeReason('forwarder_name "Expeditors" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)'),
    ).toBe('Forwarder "Expeditors" did not match master data — left unlinked')
    expect(humanizeReason('pod "USLGB" did not exact/curated-match a port master — left unlinked')).toBe(
      'Port of Discharge "USLGB" did not match a known port — left unlinked',
    )
    expect(humanizeReason('forwarder_name "Expeditors" did not exact-match a master')).not.toMatch(/forwarder_name/)
    expect(humanizeReason('pod "USLGB" did not exact/curated-match a port master')).not.toMatch(/\bpod\b/)
  })

  it('scrubs snake_case field tokens on unknown reasons', () => {
    const out = humanizeReason('check forwarder_name and in_dc_date before confirming')
    expect(out).not.toMatch(/_/)
    expect(out).toContain('Forwarder')
    expect(out).toContain('In DC Date')
  })

  it('falls back to the raw string for unknown reasons with no field tokens', () => {
    expect(humanizeReason('some brand new reason')).toBe('some brand new reason')
  })

  it('humanizes FCL/Maersk cut-off schedule notes for ops', () => {
    expect(
      humanizeReason(
        'cutoff: warehouse end set from CY cut-off 2026-07-07 17:00 (cargo — not SI/documentation)',
      ),
    ).toBe('Warehouse end set from CY cargo cut-off 2026-07-07 17:00 (not the SI/documentation deadline)')
    expect(
      humanizeReason('cutoff: warehouse start set from CY open ETD-6 days → 2026-07-04'),
    ).toBe('Warehouse start set from CY open ETD-6 days → 2026-07-04')
    expect(
      humanizeReason(
        'cutoff note: SI cut-off 2026-07-06 09:00 (shipping instruction / 截单 — documentation only, not warehouse end)',
      ),
    ).toBe('SI (shipping instruction) cut-off: 2026-07-06 09:00 — documentation only, not warehouse end')
    expect(humanizeReason('cutoff note: VGM submission deadline 2026-07-06 22:00')).toBe(
      'VGM submission deadline: 2026-07-06 22:00',
    )
    expect(humanizeReason('cutoff note: MDGF deadline 2026-07-03 17:00')).toBe('MDGF deadline: 2026-07-03 17:00')
  })

  it('dedupes identical humanized reasons', () => {
    const list = humanizeReasons([
      'output_truncated: model output cut; some records may be miss',
      'email references an attachment but none was ingested — original booking file missing',
      'output_truncated: model output cut; some records may be miss',
      'email references an attachment but none was ingested — original booking file missing',
      'forwarder_name "Expeditors" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)',
      'pod "USLGB" did not exact/curated-match a port master — left unlinked',
    ])
    expect(list.map((x) => x.text)).toEqual([
      'Model output was cut short — some POs or fields may be missing; verify the extract',
      'Referenced attachment is missing from this thread — data may be incomplete',
      'Forwarder "Expeditors" did not match master data — left unlinked',
      'Port of Discharge "USLGB" did not match a known port — left unlinked',
    ])
  })
})
