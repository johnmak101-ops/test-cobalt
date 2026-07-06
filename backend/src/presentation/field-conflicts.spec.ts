import { describe, it, expect } from 'vitest'
import { computeFieldConflicts, type IdentifierRow } from './field-conflicts'

const id = (type: string, value: string, isCurrent = true, docType: string | null = null): IdentifierRow => ({
  type,
  value,
  isCurrent,
  docType,
  sourceEmailId: null,
})

describe('computeFieldConflicts — contested fields recovered from the identifier set', () => {
  it("flags SO# when two emails give different co-current SO numbers (the 123086 case)", () => {
    const out = computeFieldConflicts([
      id('so_no', 'S2602834898', true, 'Other'),
      id('so_no', 'S285139, S285141', true, 'Invoice/Billing'),
      id('booking_no', '123086', true, 'Other'),
      id('hbl_awb_fcr_no', 'SHAJ15724', true, 'Other'),
      id('mbl', 'C2601206365', true, 'Other'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.column).toBe('soNo')
    expect(out[0]!.label).toBe('SO#')
    expect(out[0]!.values.map((v) => v.value)).toEqual(['S2602834898', 'S285139, S285141'])
    expect(out[0]!.values.map((v) => v.docType)).toEqual(['Other', 'Invoice/Billing'])
  })

  it('does not flag a field with a single co-current value', () => {
    expect(computeFieldConflicts([id('booking_no', '123086'), id('so_no', 'S1')])).toEqual([])
  })

  it('ignores superseded alternates (Draft→Final B/L is a supersede, not a conflict)', () => {
    const out = computeFieldConflicts([
      id('hbl_awb_fcr_no', 'FINAL123', true),
      id('hbl_awb_fcr_no', 'DRAFT999', false), // superseded
    ])
    expect(out).toEqual([])
  })

  it('dedupes the same value echoed across doc types (not a conflict)', () => {
    const out = computeFieldConflicts([
      id('booking_no', 'BK-100', true, 'Booking Request'),
      id('booking_no', 'BK 100', true, 'Final BOL'), // same alnum value
    ])
    expect(out).toEqual([])
  })

  it("resolves each value's source email id via the resolver (graph id → internal id; unresolved → null)", () => {
    const rows: IdentifierRow[] = [
      { type: 'hbl_awb_fcr_no', value: '63Y0006015', isCurrent: true, docType: 'Booking Request', sourceEmailId: '<graph-a@x>' },
      { type: 'hbl_awb_fcr_no', value: 'F3Y0594655', isCurrent: true, docType: 'Booking Request', sourceEmailId: '<graph-b@x>' },
    ]
    const map: Record<string, string> = { '<graph-a@x>': 'queue-uuid-a' }
    const out = computeFieldConflicts(rows, (g) => (g ? map[g] ?? null : null))
    expect(out[0]!.values.map((v) => v.sourceEmailId)).toEqual(['queue-uuid-a', null])
  })

  it('flags multiple contested identity types at once and ignores unknown types', () => {
    const out = computeFieldConflicts([
      id('mbl', 'M1', true),
      id('mbl', 'M2', true),
      id('container_no', 'C1', true),
      id('container_no', 'C2', true),
      id('customer_po', 'PO1', true), // not an identity column → ignored
      id('customer_po', 'PO2', true),
    ])
    expect(out.map((c) => c.column).sort()).toEqual(['containerNo', 'mbl'])
  })
})
