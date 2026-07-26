import { describe, it, expect } from 'vitest'
import { matchKeyIndexRows, mergeIdentityKeys } from './match-key-index'

const pairs = (rows: { shipmentId: string; type: string; value: string }[]) =>
  rows.map((r) => `${r.type}:${r.value}`).sort()

describe('matchKeyIndexRows', () => {
  it('derives one normalized row per strong key, tagged with the shipmentId', () => {
    const rows = matchKeyIndexRows('ship-1', {
      so_no: 'so-1',
      booking_no: 'BK1',
      hbl_awb_fcr_no: 'H1',
      mbl: 'M1',
      container_no: 'C1',
    })
    expect(rows.every((r) => r.shipmentId === 'ship-1')).toBe(true)
    expect(pairs(rows)).toEqual(['booking_no:BK1', 'container_no:C1', 'hbl_awb_fcr_no:H1', 'mbl:M1', 'so_no:SO1'])
  })

  it('normalizes values exactly as findExistingLeg matches (upper-case, strip non-alnum)', () => {
    expect(matchKeyIndexRows('s', { so_no: 'so/12-34' })).toEqual([{ shipmentId: 's', type: 'so_no', value: 'SO1234' }])
  })

  it('folds a booking_no revision suffix so a re-issue indexes onto its base (parity with strongKeys)', () => {
    expect(matchKeyIndexRows('s', { booking_no: 'BX845666 V3' })).toEqual([
      { shipmentId: 's', type: 'booking_no', value: 'BX845666' },
    ])
  })

  it('indexes ONLY the five strong keys — customer_po and conversation_id are never strong keys', () => {
    expect(matchKeyIndexRows('s', { customer_po: 'PO-1', conversation_id: 'conv-9' })).toEqual([])
  })

  it('skips empty/absent values and tolerates a null/undefined bag', () => {
    expect(matchKeyIndexRows('s', { so_no: '', booking_no: null })).toEqual([])
    expect(matchKeyIndexRows('s', {})).toEqual([])
    expect(matchKeyIndexRows('s', null)).toEqual([])
    expect(matchKeyIndexRows('s', undefined)).toEqual([])
  })
})

/**
 * The index is documented as a PROVABLE SUPERSET of the strong-overlap match, but `findExistingLeg` matches on
 * the leg's STORED bag while the committer rebuilt the index from the incoming decision alone (delete+insert)
 * — and the amend path never rewrites `match_keys`. Live divergence on 2026-07-26: stored
 * `{booking_no: CA771, hbl_awb_fcr_no: A26050003, ...}` vs an index of `hbl_awb_fcr_no=SZA26050003, mbl=...`
 * with NO CA771, so a later decision keyed on CA771 could not retrieve the leg and would mint a duplicate.
 */
describe('mergeIdentityKeys — the index must never be narrower than what findExistingLeg matches on', () => {
  it('KEEPS a stored key type the incoming decision omits (the CA771 case)', () => {
    const merged = mergeIdentityKeys(
      { booking_no: 'CA771', hbl_awb_fcr_no: 'A26050003', mbl: '999-92908152' },
      { hbl_awb_fcr_no: 'SZA26050003', mbl: '999-92908152', customer_po: '1570988' },
    )
    expect(merged.booking_no).toBe('CA771')
    expect(pairs(matchKeyIndexRows('s', merged))).toContain('booking_no:CA771')
  })

  it('lets the incoming value WIN for a type both state — a correction must not keep the old value', () => {
    const merged = mergeIdentityKeys({ hbl_awb_fcr_no: 'A26050003' }, { hbl_awb_fcr_no: 'SZA26050003' })
    expect(merged.hbl_awb_fcr_no).toBe('SZA26050003')
    // one row, not two: the leg must stop being retrievable by the value it no longer has
    expect(pairs(matchKeyIndexRows('s', merged))).toEqual(['hbl_awb_fcr_no:SZA26050003'])
  })

  it('does not let an empty or null incoming value erase a stored one', () => {
    const merged = mergeIdentityKeys({ booking_no: 'BK1', so_no: 'SO1' }, { booking_no: '', so_no: null, mbl: '   ' })
    expect(merged).toMatchObject({ booking_no: 'BK1', so_no: 'SO1' })
    expect(merged.mbl).toBeUndefined()
  })

  it('carries non-strong keys through untouched (customer_po / conversation_id live in the same bag)', () => {
    const merged = mergeIdentityKeys({ customer_po: '1570988', conversation_id: 'conv-A' }, { mbl: 'M9' })
    expect(merged).toMatchObject({ customer_po: '1570988', conversation_id: 'conv-A', mbl: 'M9' })
    expect(pairs(matchKeyIndexRows('s', merged))).toEqual(['mbl:M9'])
  })

  it('tolerates null/undefined on either side and never mutates the inputs', () => {
    const stored = { booking_no: 'BK1' }
    expect(mergeIdentityKeys(null, null)).toEqual({})
    expect(mergeIdentityKeys(stored, null)).toEqual({ booking_no: 'BK1' })
    expect(mergeIdentityKeys(null, stored)).toEqual({ booking_no: 'BK1' })
    mergeIdentityKeys(stored, { so_no: 'SO2' })
    expect(stored).toEqual({ booking_no: 'BK1' })
  })

  it('is idempotent — re-committing the same decision changes nothing', () => {
    const a = mergeIdentityKeys({ booking_no: 'BK1' }, { hbl_awb_fcr_no: 'H1' })
    expect(mergeIdentityKeys(a, { hbl_awb_fcr_no: 'H1' })).toEqual(a)
  })
})
