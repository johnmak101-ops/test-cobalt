import { describe, it, expect } from 'vitest'
import { matchKeyIndexRows } from './match-key-index'

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
