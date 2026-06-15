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

  it('identity: two EQUAL-authority different values are a real conflict', () => {
    const r = mergeShipment([
      e('2026-01-01', 'Final B/L', { hbl_awb_fcr_no: 'AAA' }),
      e('2026-01-02', 'Final B/L', { hbl_awb_fcr_no: 'BBB' }),
    ])
    expect(r.conflicts.length).toBeGreaterThan(0)
  })

  it('entity: a different party clashes at any rank, but a suffix variant does not', () => {
    const clash = mergeShipment([
      e('2026-01-01', 'Draft B/L', { consignee_name: 'ELEGANT SMART CORP' }),
      e('2026-01-02', 'Final B/L', { consignee_name: 'STRAUSS OPERATIONS' }),
    ])
    expect(clash.conflicts.some((c) => c.startsWith('consignee_name'))).toBe(true)
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
})
