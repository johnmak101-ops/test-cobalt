import { describe, it, expect } from 'vitest'
import { mergeShipment, type CriticEmail } from './merge'

const e = (receivedAt: string, emailType: string, fields: Record<string, unknown>, pos: string[] = []): CriticEmail => ({
  receivedAt,
  emailType,
  fields,
  pos,
})

describe('mergeShipment — Critic merge policy', () => {
  it('identity: first value wins when nothing more authoritative disagrees', () => {
    const r = mergeShipment([e('2026-01-01', 'Booking Request', { so_no: 'SO-1' }), e('2026-01-02', 'SO', { so_no: 'SO-1' })])
    expect(r.fields.so_no).toBe('SO-1')
    expect(r.conflicts).toHaveLength(0)
  })

  it('identity: a more authoritative doc SUPERSEDES the old value — lifecycle, not a conflict', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Booking Request', { hbl_awb_fcr_no: 'AAA' }),
      e('2026-01-02', 'Final B/L', { hbl_awb_fcr_no: 'BBB' }),
    ])
    expect(r.fields.hbl_awb_fcr_no).toBe('BBB') // authoritative value wins
    expect(r.conflicts).toHaveLength(0) // maturation isn't penalized
  })

  it('identity: two EQUAL-authority different values are co-current (not a conflict) — #117', () => {
    // Matches queue: multi-HBL / consolidation at equal rank is NOT a field-value conflict.
    const r = mergeShipment([
      e('2026-01-01', 'Final B/L', { hbl_awb_fcr_no: 'AAA' }),
      e('2026-01-02', 'Final B/L', { hbl_awb_fcr_no: 'BBB' }),
    ])
    expect(r.conflicts).toEqual([])
    expect(r.notes.some((n) => n.includes('hbl_awb_fcr_no') && n.includes('co-current'))).toBe(true)
    // kept field is one of the co-current values (arrival-order first when ranks equal)
    expect(r.fields.hbl_awb_fcr_no).toBe('AAA')
  })

  it('entity names: the authoritative doc wins a lower-rank mis-extraction; equal-rank party clash flags', () => {
    // lower-rank shipper-as-consignee loses to the Final B/L — no conflict
    const authoritative = mergeShipment([
      e('2026-01-01', 'SO', { consignee_name: 'MACAU FUNG TAI LIMITED' }),
      e('2026-01-02', 'Final B/L', { consignee_name: 'WYSE LONDON LTD' }),
    ])
    expect(authoritative.fields.consignee_name).toBe('WYSE LONDON LTD')
    expect(authoritative.conflicts).toHaveLength(0)
    // two equal-authority docs naming different parties → conflict
    const clash = mergeShipment([
      e('2026-01-01', 'Final B/L', { consignee_name: 'ELEGANT SMART CORP' }),
      e('2026-01-02', 'Final B/L', { consignee_name: 'STRAUSS OPERATIONS' }),
    ])
    expect(clash.conflicts.some((c) => c.startsWith('consignee_name'))).toBe(true)
    // suffix variant is the same party
    const variant = mergeShipment([
      e('2026-01-01', 'Booking Request', { consignee_name: 'WYSE LONDON' }),
      e('2026-01-02', 'SO', { consignee_name: 'WYSE LONDON LTD' }),
    ])
    expect(variant.conflicts).toHaveLength(0)
  })

  it('identity: a LOWER-authority later doc does NOT override the kept value', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Final B/L', { hbl_awb_fcr_no: 'BBB' }),
      e('2026-01-02', 'Booking Request', { hbl_awb_fcr_no: 'AAA' }),
    ])
    expect(r.fields.hbl_awb_fcr_no).toBe('BBB') // Final B/L wins; Booking can't override
  })

  it('identity: equal values (ignoring formatting) are not a conflict', () => {
    const r = mergeShipment([e('2026-01-01', 'SO', { mbl: 'MBL 123' }), e('2026-01-02', 'Draft B/L', { mbl: 'mbl-123' })])
    expect(r.conflicts).toHaveLength(0)
  })

  it('schedule: the latest email wins (dates get re-quoted)', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Booking Request', { etd: '2026-02-10' }),
      e('2026-01-05', 'SO', { etd: '2026-02-14' }),
    ])
    expect(r.fields.etd).toBe('2026-02-14')
  })

  it('quantity/text: the most authoritative document wins', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Booking Request', { qty: '100' }),
      e('2026-01-02', 'Final B/L', { qty: '120' }),
    ])
    expect(r.fields.qty).toBe('120')
  })

  it('po: union across the whole thread, sorted', () => {
    const r = mergeShipment([e('2026-01-01', 'Booking Request', {}, ['PO2']), e('2026-01-02', 'SO', {}, ['PO2', 'PO1'])])
    expect(r.pos).toEqual(['PO1', 'PO2'])
  })

  it('orders by receivedAt regardless of input order', () => {
    const r = mergeShipment([
      e('2026-01-09', 'SO', { etd: '2026-03-01' }),
      e('2026-01-01', 'Booking Request', { etd: '2026-02-01' }),
    ])
    expect(r.fields.etd).toBe('2026-03-01') // latest by receivedAt
  })

  // Coverage parity with cobalt-queue critic/merge FIELD_CLASS: fields the parser now extracts must merge
  // through on the reconcile path, not be silently dropped.
  it('schedule: ata merges (latest wins) — was dropped', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Draft B/L', { ata: '2026-03-01' }),
      e('2026-01-05', 'Final B/L', { ata: '2026-03-03' }),
    ])
    expect(r.fields.ata).toBe('2026-03-03')
  })

  it('text: the "extract all info" fields (vessel/scac/weight/pol …) merge, best doc wins — were dropped', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Booking Request', { vessel_name: 'GUESS', scac_code: 'ONEY', gross_weight: '100', pol: 'CNSHK' }),
      e('2026-01-02', 'Final B/L', { vessel_name: 'EVER GIVEN', scac_code: 'EGLV', gross_weight: '120', pol: 'CNYTN' }),
    ])
    expect(r.fields.vessel_name).toBe('EVER GIVEN')
    expect(r.fields.scac_code).toBe('EGLV')
    expect(r.fields.gross_weight).toBe('120')
    expect(r.fields.pol).toBe('CNYTN')
  })

  it('list: item_style_no / hts_code UNION across records (deduped, order-preserving)', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Booking Request', { item_style_no: 'A100, A200', hts_code: '6109' }),
      e('2026-01-02', 'SO', { item_style_no: 'A200, A300', hts_code: '6110' }),
    ])
    expect(r.fields.item_style_no).toBe('A100,A200,A300')
    expect(r.fields.hts_code).toBe('6109,6110')
  })
})
