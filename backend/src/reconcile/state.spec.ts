import { describe, it, expect } from 'vitest'
import { deriveState, normMode, MILESTONE_OF, classifyKind, classifyKindDetail } from './state'

describe('deriveState — 6-state staircase', () => {
  it('defaults to BOOKED', () => {
    expect(deriveState(new Set(), {})).toBe('BOOKED')
  })
  it('SO present → CONFIRMED', () => {
    expect(deriveState(new Set(['SO']), {})).toBe('CONFIRMED')
    expect(deriveState(new Set(), { so_no: 'X' })).toBe('CONFIRMED')
  })
  it('Draft B/L or past warehouse date → AT_WAREHOUSE', () => {
    expect(deriveState(new Set(['Draft B/L']), {})).toBe('AT_WAREHOUSE')
    expect(deriveState(new Set(), { warehouse_start_date: '2026-02-01' }, new Date('2026-02-15T00:00:00Z'))).toBe(
      'AT_WAREHOUSE',
    )
  })
  it('future warehouse_start alone does NOT promote (planned CFS open ≠ already at warehouse)', () => {
    // Booking / Nexus form often has a future CY open; that is schedule, not AT_WAREHOUSE yet.
    expect(
      deriveState(new Set(['Booking Request']), { warehouse_start_date: '2026-07-21', so_no: 'SO1' }, new Date('2026-07-05T00:00:00Z')),
    ).toBe('CONFIRMED')
    expect(
      deriveState(new Set(['Booking Request']), { warehouse_start_date: '2026-07-21' }, new Date('2026-07-05T00:00:00Z')),
    ).toBe('BOOKED')
  })
  it('ex-factory / cargo_ready alone never reaches AT_WAREHOUSE', () => {
    expect(
      deriveState(
        new Set(['Booking Request']),
        { cargo_ready_date: '2026-07-20', so_no: '202654650377' },
        new Date('2026-07-13T00:00:00Z'),
      ),
    ).toBe('CONFIRMED')
  })
  it('actual departure → SAILED', () => {
    expect(deriveState(new Set(['Draft B/L']), { atd: '2026-02-10' })).toBe('SAILED')
  })
  it('Departure Notice email type (On-board / Departure date keywords) → SAILED', () => {
    expect(deriveState(new Set(['Departure Notice']), {})).toBe('SAILED')
  })
  it('Invoice/Billing with a PAST ETD + a carrier doc (MBL or HBL/FCR) → SAILED (invoices are post-departure)', () => {
    const now = new Date('2026-07-13T00:00:00Z')
    // MBL (the original BUG-7 case)
    expect(deriveState(new Set(['Invoice/Billing']), { mbl: 'MEDU1', etd: '2026-05-31' }, now)).toBe('SAILED')
    // HBL/FCR only (the carrier number lands here, not in mbl — the 270639828 invoice case)
    expect(deriveState(new Set(['Invoice/Billing']), { hbl_awb_fcr_no: '5548410963', etd: '2026-05-31' }, now)).toBe(
      'SAILED',
    )
  })
  it('Invoice/Billing with a FUTURE ETD does NOT promote to SAILED (not yet departed)', () => {
    const now = new Date('2026-05-01T00:00:00Z')
    expect(deriveState(new Set(['Invoice/Billing']), { hbl_awb_fcr_no: '5548410963', etd: '2026-05-31' }, now)).toBe(
      'BOOKED',
    )
  })
  it('a non-invoice Booking Request with a past ETD + HBL stays BOOKED (no false promotion of drafts)', () => {
    const now = new Date('2026-07-13T00:00:00Z')
    expect(deriveState(new Set(['Booking Request']), { hbl_awb_fcr_no: '5548410963', etd: '2026-05-31' }, now)).toBe(
      'BOOKED',
    )
  })
  it('Telex / Final B/L → RELEASED', () => {
    expect(deriveState(new Set(['Telex Release']), {})).toBe('RELEASED')
    expect(deriveState(new Set(['Final B/L']), {})).toBe('RELEASED')
  })
  it('in-DC date alone does NOT reach DELIVERED without a departure signal', () => {
    // a delivery cannot precede departure — in_dc with no atd/Final B/L/Telex stays at the prior stage
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01' })).toBe('CONFIRMED')
  })
  it('in-DC date + departure (atd) → DELIVERED (highest reached wins)', () => {
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01', atd: '2026-02-20' })).toBe('DELIVERED')
  })
  it('ETD calendar day equals today → DELIVERED (ops rule)', () => {
    const now = new Date('2026-07-21T15:00:00Z')
    expect(deriveState(new Set(['SO']), { etd: '2026-07-21' }, now)).toBe('DELIVERED')
    expect(deriveState(new Set(['SO']), { etd: '2026-07-21T00:00:00.000Z' }, now)).toBe('DELIVERED')
  })
  it('ETD on another day does not alone promote to DELIVERED', () => {
    const now = new Date('2026-07-21T15:00:00Z')
    expect(deriveState(new Set(['SO']), { etd: '2026-07-20' }, now)).toBe('CONFIRMED')
  })
})

describe('normMode', () => {
  it('maps known labels', () => {
    expect(normMode('Sea')).toBe('SEA')
    expect(normMode('Sea-LCL')).toBe('SEA_LCL')
    expect(normMode('Air')).toBe('AIR')
  })
  it('falls back by prefix, null when unknown', () => {
    expect(normMode('sea freight')).toBe('SEA')
    expect(normMode('air cargo')).toBe('AIR')
    expect(normMode('rail')).toBeNull()
    expect(normMode(null)).toBeNull()
  })
})

describe('classifyKind — SHIPMENT vs DOCUMENT (Documents = Invoice/Billing only)', () => {
  const invoice = new Set(['Invoice/Billing'])
  it('Invoice/Billing-only without booking_no → DOCUMENT (SO/HBL/container alone still park)', () => {
    expect(classifyKind(invoice, {})).toBe('DOCUMENT')
    expect(classifyKind(invoice, { so_no: 'CMS364079' })).toBe('DOCUMENT')
    expect(classifyKind(invoice, { hbl_awb_fcr_no: 'Z13764183' })).toBe('DOCUMENT')
    expect(classifyKind(invoice, { container_no: 'WHSU0570946' })).toBe('DOCUMENT')
  })
  it('Invoice/Billing-only WITH booking_no → SHIPMENT (clear booking, do not park as DOCUMENT)', () => {
    expect(classifyKind(invoice, { booking_no: 'BX845666' })).toBe('SHIPMENT')
    expect(classifyKind(invoice, { so_no: 'CMS364079', booking_no: 'BX845666' })).toBe('SHIPMENT')
  })
  it('bare orphan (Other, no id) → SHIPMENT (ops chat/cancel/ack is not a Document)', () => {
    expect(classifyKind(new Set(['Other']), {})).toBe('SHIPMENT')
  })
  it('an SO document (lifecycle type) with an so_no stays SHIPMENT', () => {
    expect(classifyKind(new Set(['SO']), { so_no: 'CMS364079' })).toBe('SHIPMENT')
  })
  it("a non-invoice 'Other' leg with an so_no stays SHIPMENT", () => {
    expect(classifyKind(new Set(['Other']), { so_no: 'CMS364079' })).toBe('SHIPMENT')
  })
  it('a Booking Request with no booking# yet stays SHIPMENT (gains identity later)', () => {
    expect(classifyKind(new Set(['Booking Request']), {})).toBe('SHIPMENT')
  })
  it('Invoice/Billing mixed with Booking Request stays SHIPMENT', () => {
    expect(classifyKind(new Set(['Invoice/Billing', 'Booking Request']), { booking_no: 'BX1' })).toBe('SHIPMENT')
  })
  it('platform-only "Other" alert with portal booking# → SHIPMENT (flag only)', () => {
    expect(classifyKind(new Set(['Other']), { booking_no: 'FENLPO003034A' }, { fromPlatform: true })).toBe('SHIPMENT')
  })
  it('the SAME leg NOT flagged from the platform stays SHIPMENT', () => {
    expect(classifyKind(new Set(['Other']), { booking_no: 'FENLPO003034A' })).toBe('SHIPMENT')
  })
  it('platform-flagged BUT with a lifecycle email stays SHIPMENT', () => {
    expect(classifyKind(new Set(['Booking Request']), { booking_no: 'X' }, { fromPlatform: true })).toBe('SHIPMENT')
  })
})

describe('classifyKindDetail — Invoice/Billing → DOCUMENT; others SHIPMENT + optional flag', () => {
  const invoice = new Set(['Invoice/Billing'])
  it('Invoice/Billing-only without booking_no → DOCUMENT + invoice_so_ref', () => {
    expect(classifyKindDetail(invoice, { so_no: 'CMS364079' })).toEqual({ kind: 'DOCUMENT', rule: 'invoice_so_ref' })
    expect(classifyKindDetail(invoice, {})).toEqual({ kind: 'DOCUMENT', rule: 'invoice_so_ref' })
  })
  it('Invoice/Billing-only with booking_no → SHIPMENT + invoice_with_booking', () => {
    expect(classifyKindDetail(invoice, { booking_no: 'BX845666' })).toEqual({
      kind: 'SHIPMENT',
      rule: 'invoice_with_booking',
    })
  })
  it('bare orphan → SHIPMENT + bare_orphan (flag only)', () => {
    expect(classifyKindDetail(new Set(['Other']), {})).toEqual({ kind: 'SHIPMENT', rule: 'bare_orphan' })
  })
  it('platform-only portal booking# → SHIPMENT + platform_only (flag only)', () => {
    expect(classifyKindDetail(new Set(['Other']), { booking_no: 'FENLPO003034A' }, { fromPlatform: true })).toEqual({
      kind: 'SHIPMENT',
      rule: 'platform_only',
    })
  })
  it('a real booking → kind SHIPMENT, rule null', () => {
    expect(classifyKindDetail(new Set(['Booking Request']), { booking_no: 'BX845666' })).toEqual({
      kind: 'SHIPMENT',
      rule: null,
    })
  })
  it('classifyKind wrapper still returns the kind string only', () => {
    expect(classifyKind(new Set(['Other']), {})).toBe('SHIPMENT')
    expect(classifyKind(invoice, {})).toBe('DOCUMENT')
  })
})

describe('MILESTONE_OF', () => {
  it('maps email types to milestones', () => {
    expect(MILESTONE_OF['Booking Request']).toBe('BOOKING_SENT')
    expect(MILESTONE_OF['Final B/L']).toBe('FINAL_BL_RECEIVED')
    expect(MILESTONE_OF['Other']).toBeUndefined()
  })
})
