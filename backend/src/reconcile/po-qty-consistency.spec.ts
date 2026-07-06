import { describe, it, expect } from 'vitest'
import { poQtyIssue, describePoQtyIssue } from './po-qty-consistency'

describe('poQtyIssue — per-PO shipped qty vs the ERP purchase order', () => {
  it('flags a shipped qty that exceeds the ordered total (same unit)', () => {
    // the BX876110 case: 184 cartons attributed to a PO ordered for 28
    expect(poQtyIssue({ legQty: 184, legUnit: 'cartons', poTotal: 28, poUnit: 'cartons' })).toBe('exceeds_total')
    expect(describePoQtyIssue('exceeds_total', { legQty: 184, legUnit: 'cartons', poTotal: 28, poUnit: 'cartons' })).toBe(
      'shipped 184 exceeds ordered 28',
    )
  })

  it('flags a unit mismatch even when the number is within the total', () => {
    // 184 cartons attributed to a PO measured in pieces (184 <= 184, but the units differ)
    expect(poQtyIssue({ legQty: 184, legUnit: 'cartons', poTotal: 184, poUnit: 'pieces' })).toBe('unit_mismatch')
    expect(describePoQtyIssue('unit_mismatch', { legQty: 184, legUnit: 'cartons', poTotal: 184, poUnit: 'pieces' })).toBe(
      'unit differs: shipped in cartons, ordered in pieces',
    )
  })

  it('unit mismatch takes priority over an excess', () => {
    expect(poQtyIssue({ legQty: 300, legUnit: 'cartons', poTotal: 28, poUnit: 'pieces' })).toBe('unit_mismatch')
  })

  it('passes a consistent row (same unit, within total)', () => {
    expect(poQtyIssue({ legQty: 89, legUnit: 'cartons', poTotal: 89, poUnit: 'cartons' })).toBeNull()
    expect(poQtyIssue({ legQty: 50, legUnit: 'cartons', poTotal: 110, poUnit: 'cartons' })).toBeNull()
  })

  it('does not flag when there is nothing to check', () => {
    expect(poQtyIssue({ legQty: null, legUnit: 'cartons', poTotal: 28, poUnit: 'cartons' })).toBeNull() // no attributed qty
    expect(poQtyIssue({ legQty: 184, legUnit: 'cartons', poTotal: null, poUnit: 'cartons' })).toBeNull() // no PO total to compare
    expect(poQtyIssue({ legQty: 184, legUnit: null, poTotal: 184, poUnit: 'pieces' })).toBeNull() // leg unit unknown → can't call it a mismatch
  })

  it('treats units case/space-insensitively', () => {
    expect(poQtyIssue({ legQty: 10, legUnit: ' Cartons ', poTotal: 20, poUnit: 'CARTONS' })).toBeNull()
  })
})
