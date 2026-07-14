import { describe, it, expect } from 'vitest'
import { categorizeReason, categoriesOf } from './review-reasons'

// Real reason strings as produced by the committer hints, review policy labels, disposition
// reasons, and the queue matcher gate. Categories drive the Review Queue filter chips (#133).
const CASES: Array<[string, string]> = [
  ['platform/portal email without carrier identity — verify booking_no is not a portal LPO', 'portal'],
  ['the email is only a portal alert (not a real booking update)', 'portal'],
  ['backend conflict on qty, gross_weight', 'conflict'],
  ['2 unresolved field conflict(s)', 'conflict'],
  ['the email disagrees with what’s already on the shipment', 'conflict'],
  ['mode change SEA → AIR', 'conflict'],
  ['transport switched between sea and air', 'conflict'],
  ['PO 2605358: brand conflict KOHLS vs SONOMA (kept KOHLS)', 'conflict'],
  ['PO-linked group with an identity supersede (possible over-merge of two shipments)', 'multi_id'],
  ['≥2 distinct co-current values of one strong-id type', 'multi_id'],
  ['matched multiple backend legs', 'multi_id'],
  ['a PO on this email currently belongs to a different shipment', 'multi_id'],
  ['the same reference number already belongs to another shipment', 'multi_id'],
  ['the shipment was moved or reassigned', 'multi_id'],
  ['no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment', 'no_identity'],
  ['neither a strong identity key nor a PO', 'no_identity'],
  ['there’s no booking, bill of lading, AWB, or container number', 'no_identity'],
  ['there’s no purchase order', 'no_identity'],
  ['insufficient identity for auto-apply', 'no_identity'],
  ['forwarder_name "VENA SAIL" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)', 'master_miss'],
  ['pol "CHITTAGONG" did not exact/curated-match a port master — left unlinked', 'master_miss'],
  ['the customer is new or not recognized', 'master_miss'],
  ['new shipment for an unknown / unresolved customer', 'master_miss'],
  ['PO present but customer not known', 'master_miss'],
  ['vision_pending: 2 image attachments not read yet', 'extraction'],
  ['output_truncated — model JSON cut mid-generation', 'extraction'],
  ['body says a file was attached but no attachment was ingested', 'extraction'],
  ['missing cargo detail (qty/gross weight/measurement all empty)', 'extraction'],
  ['ack-only reply with an unlabeled inline screenshot', 'extraction'],
  ['PO 2605358: total_quantity 692 looks like a broadcast total', 'extraction'],
  ['cutoff note: SI cut-off 2026-07-01 (shipping instruction only)', 'other'],
  ['Booking cancelled', 'other'],
]

describe('categorizeReason (#133 filter chips)', () => {
  it.each(CASES)('%s → %s', (raw, expected) => {
    expect(categorizeReason(raw)).toBe(expected)
  })

  it('categoriesOf unions categories and defaults empty → other', () => {
    expect([...categoriesOf([])]).toEqual(['other'])
    const cats = categoriesOf([
      'the email is only a portal alert (not a real booking update)',
      'backend conflict on qty',
    ])
    expect(cats.has('portal')).toBe(true)
    expect(cats.has('conflict')).toBe(true)
  })
})
