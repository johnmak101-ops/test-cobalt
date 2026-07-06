import { describe, it, expect } from 'vitest'
import { deriveState, normMode, MILESTONE_OF, classifyKind } from './state'

describe('deriveState — 6-state staircase', () => {
  it('defaults to BOOKED', () => {
    expect(deriveState(new Set(), {})).toBe('BOOKED')
  })
  it('SO present → CONFIRMED', () => {
    expect(deriveState(new Set(['SO']), {})).toBe('CONFIRMED')
    expect(deriveState(new Set(), { so_no: 'X' })).toBe('CONFIRMED')
  })
  it('Draft B/L or warehouse date → AT_WAREHOUSE', () => {
    expect(deriveState(new Set(['Draft B/L']), {})).toBe('AT_WAREHOUSE')
    expect(deriveState(new Set(), { warehouse_start_date: '2026-02-01' })).toBe('AT_WAREHOUSE')
  })
  it('actual departure → SAILED', () => {
    expect(deriveState(new Set(['Draft B/L']), { atd: '2026-02-10' })).toBe('SAILED')
  })
  it('Telex / Final B/L → RELEASED', () => {
    expect(deriveState(new Set(['Telex Release']), {})).toBe('RELEASED')
  })
  it('in-DC date alone does NOT reach DELIVERED without a departure signal', () => {
    // a delivery cannot precede departure — in_dc with no atd/Final B/L/Telex stays at the prior stage
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01' })).toBe('CONFIRMED')
  })
  it('in-DC date + departure (atd) → DELIVERED (highest reached wins)', () => {
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01', atd: '2026-02-20' })).toBe('DELIVERED')
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

describe('classifyKind — SHIPMENT vs DOCUMENT', () => {
  const invoice = new Set(['Invoice/Billing'])
  it('bare orphan (no id, no lifecycle doc) → DOCUMENT', () => {
    expect(classifyKind(new Set(['Other']), {})).toBe('DOCUMENT')
  })
  it('CVP invoice-only with only an order-reference so_no → DOCUMENT', () => {
    // the screenshot case: all emails Invoice/Billing, so_no set, no booking/BL/container
    expect(classifyKind(invoice, { so_no: 'CMS364079' })).toBe('DOCUMENT')
  })
  it('invoice-only BUT carrying a real booking#/BL/container → SHIPMENT (a booked move the invoice reports)', () => {
    expect(classifyKind(invoice, { so_no: 'CMS364079', booking_no: 'BX845666' })).toBe('SHIPMENT')
    expect(classifyKind(invoice, { hbl_awb_fcr_no: 'Z13764183' })).toBe('SHIPMENT')
    expect(classifyKind(invoice, { container_no: 'WHSU0570946' })).toBe('SHIPMENT')
  })
  it('an SO document (lifecycle type) with an so_no stays SHIPMENT', () => {
    expect(classifyKind(new Set(['SO']), { so_no: 'CMS364079' })).toBe('SHIPMENT')
  })
  it("a non-invoice 'Other' leg with an so_no stays SHIPMENT (rule is CVP-invoice-only)", () => {
    expect(classifyKind(new Set(['Other']), { so_no: 'CMS364079' })).toBe('SHIPMENT')
  })
  it('a Booking Request with no booking# yet stays SHIPMENT (gains identity later)', () => {
    expect(classifyKind(new Set(['Booking Request']), {})).toBe('SHIPMENT')
  })

  // Rule (c): a leg built ENTIRELY from the CVP/TradeLinkOne notification platform (all source emails
  // sent by the portal) is a vendor/PO notification, not a booked move — the portal leaks its own
  // LPO reference into booking_no. Demote to DOCUMENT UNLESS a real carrier identity or a lifecycle
  // email proves an actual shipment. Field shape alone can't tell it apart (see the invoice+booking#
  // case above), so the discriminator is fromPlatform. The screenshot case: FENLPO003034A.
  it('platform-only "Other" alert whose only identity is a portal booking# → DOCUMENT', () => {
    expect(classifyKind(new Set(['Other']), { booking_no: 'FENLPO003034A' }, { fromPlatform: true })).toBe('DOCUMENT')
  })
  it('the SAME leg NOT flagged from the platform stays SHIPMENT (a real booking# is a booked move)', () => {
    expect(classifyKind(new Set(['Other']), { booking_no: 'FENLPO003034A' })).toBe('SHIPMENT')
  })
  it('platform-only BUT carrying a real carrier id (MBL/BL/container) stays SHIPMENT', () => {
    expect(classifyKind(new Set(['Invoice/Billing']), { booking_no: 'X', mbl: 'WHLC123' }, { fromPlatform: true })).toBe('SHIPMENT')
  })
  it('platform-flagged BUT with a lifecycle email stays SHIPMENT', () => {
    expect(classifyKind(new Set(['Booking Request']), { booking_no: 'X' }, { fromPlatform: true })).toBe('SHIPMENT')
  })
})

describe('MILESTONE_OF', () => {
  it('maps email types to milestones', () => {
    expect(MILESTONE_OF['Booking Request']).toBe('BOOKING_SENT')
    expect(MILESTONE_OF['Final B/L']).toBe('FINAL_BL_RECEIVED')
    expect(MILESTONE_OF['Other']).toBeUndefined()
  })
})
