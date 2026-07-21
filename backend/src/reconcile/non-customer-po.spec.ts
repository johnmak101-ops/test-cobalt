import { describe, it, expect } from 'vitest'
import { isLikelyNonCustomerPo, demotePackingLinePos } from './non-customer-po'

describe('isLikelyNonCustomerPo', () => {
  it('flags ASNE LC / DF invoice tokens', () => {
    expect(isLikelyNonCustomerPo('ASNE24054844907')).toBe(true)
    expect(isLikelyNonCustomerPo('DF2026G031')).toBe(true)
  })
  it('flags pure 9+ digit packing-line ids (standalone shells)', () => {
    expect(isLikelyNonCustomerPo('319001345')).toBe(true)
    expect(isLikelyNonCustomerPo('319001824')).toBe(true)
  })
  it('keeps real customer POs', () => {
    expect(isLikelyNonCustomerPo('1570988')).toBe(false)
    expect(isLikelyNonCustomerPo('28642')).toBe(false)
    expect(isLikelyNonCustomerPo('25312')).toBe(false)
  })
})

describe('demotePackingLinePos', () => {
  it('demotes ASNE and packing-line 9-digit when short real PO present', () => {
    const { keep, demoted } = demotePackingLinePos([
      '1570988',
      'ASNE24054844907',
      '319001345',
      '319001552',
      'DF2026G031',
    ])
    expect(keep).toEqual(['1570988'])
    expect(demoted).toEqual(expect.arrayContaining(['ASNE24054844907', '319001345', '319001552', 'DF2026G031']))
  })
  it('demotes standalone 31900… with no real PO co-present (no shell mint)', () => {
    const { keep, demoted } = demotePackingLinePos(['319001345', '319001552'])
    expect(keep).toEqual([])
    expect(demoted.sort()).toEqual(['319001345', '319001552'].sort())
  })
  it('does not demote Set5 short digit PO sets', () => {
    const pos = ['28630', '28631', '28642', '28739']
    const { keep, demoted } = demotePackingLinePos(pos)
    expect(keep.sort()).toEqual([...pos].sort())
    expect(demoted).toEqual([])
  })
})
