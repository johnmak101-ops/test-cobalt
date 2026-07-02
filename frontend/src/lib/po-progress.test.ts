import { describe, it, expect } from 'vitest'
import { poProgress, progressLabel, furthestStatusLabel } from './po-progress'

describe('poProgress — lifecycle-weighted PO fulfillment', () => {
  it('fully-booked PO on a BOOKED shipment is 15%, not 100% (the misleading-progress bug)', () => {
    const p = poProgress(2, [{ status: 'BOOKED', linkedQuantity: 2 }])
    expect(p.pct).toBe(15)
    expect(p.bookedQuantity).toBe(2)
    expect(p.shippedQuantity).toBe(0)
  })

  it('fully-delivered PO is 100% with all quantity shipped', () => {
    const p = poProgress(20, [{ status: 'ARRIVED', linkedQuantity: 20 }])
    expect(p.pct).toBe(100)
    expect(p.bookedQuantity).toBe(0)
    expect(p.shippedQuantity).toBe(20)
  })

  it('SAILED means "Final BOL" (a document stage) — quantity is still BOOKED, not shipped', () => {
    const p = poProgress(20, [{ status: 'SAILED', linkedQuantity: 20 }])
    expect(p.bookedQuantity).toBe(20)
    expect(p.shippedQuantity).toBe(0)
    expect(p.pct).toBe(65)
  })

  it('weights mixed lifecycle states by linked quantity', () => {
    const p = poProgress(20, [
      { status: 'ARRIVED', linkedQuantity: 10 },
      { status: 'BOOKED', linkedQuantity: 10 },
    ])
    expect(p.pct).toBe(57.5) // (10×100 + 10×15) / 20
    expect(p.bookedQuantity).toBe(10)
    expect(p.shippedQuantity).toBe(10)
  })

  it('under-allocation drags progress down (unbooked remainder counts as 0)', () => {
    const p = poProgress(10, [{ status: 'ARRIVED', linkedQuantity: 5 }])
    expect(p.pct).toBe(50)
  })

  it('over-allocation never exceeds 100%', () => {
    const p = poProgress(2, [{ status: 'ARRIVED', linkedQuantity: 4 }])
    expect(p.pct).toBe(100)
  })

  it('DEPARTED ("Departure") counts as shipped — the goods physically left', () => {
    const p = poProgress(4, [{ status: 'DEPARTED', linkedQuantity: 4 }])
    expect(p.shippedQuantity).toBe(4)
    expect(p.bookedQuantity).toBe(0)
    expect(p.pct).toBe(85)
  })

  it('accepts both vocabularies: raw leg states and UI staircase', () => {
    expect(poProgress(1, [{ status: 'RELEASED', linkedQuantity: 1 }]).pct).toBe(85)
    expect(poProgress(1, [{ status: 'DEPARTED', linkedQuantity: 1 }]).pct).toBe(85)
    expect(poProgress(1, [{ status: 'DELIVERED', linkedQuantity: 1 }]).pct).toBe(100)
  })

  it('falls back to the furthest shipment state when no link carries a quantity', () => {
    const p = poProgress(100, [{ status: 'BOOKED' }, { status: 'DEPARTED' }])
    expect(p.pct).toBe(85)
    expect(p.bookedQuantity).toBeNull()
    expect(p.shippedQuantity).toBeNull()
  })

  it('excludes CANCELLED shipments from progress and quantities', () => {
    const p = poProgress(2, [
      { status: 'CANCELLED', linkedQuantity: 5 },
      { status: 'BOOKED', linkedQuantity: 2 },
    ])
    expect(p.pct).toBe(15)
    expect(p.bookedQuantity).toBe(2)
    expect(p.shippedQuantity).toBe(0)
  })

  it('a PO whose only shipments are cancelled has zero progress', () => {
    const p = poProgress(2, [{ status: 'CANCELLED', linkedQuantity: 2 }])
    expect(p.pct).toBe(0)
    expect(p.bookedQuantity).toBeNull()
    expect(p.shippedQuantity).toBeNull()
  })

  it('treats unknown/null status as BOOKED (backend default)', () => {
    expect(poProgress(2, [{ status: null, linkedQuantity: 2 }]).pct).toBe(15)
    expect(poProgress(2, [{ status: 'SOMETHING_ELSE', linkedQuantity: 2 }]).pct).toBe(15)
  })

  it('no linked shipments → 0%, unknown quantities', () => {
    const p = poProgress(10, [])
    expect(p.pct).toBe(0)
    expect(p.bookedQuantity).toBeNull()
    expect(p.shippedQuantity).toBeNull()
  })

  it('unknown PO total: weights over the allocated quantity instead', () => {
    const p = poProgress(null, [
      { status: 'ARRIVED', linkedQuantity: 5 },
      { status: 'BOOKED', linkedQuantity: 5 },
    ])
    expect(p.pct).toBe(57.5)
  })
})

describe('progressLabel — plain language, never a percentage', () => {
  it('shows shipped-of-total when quantities are known', () => {
    expect(progressLabel(2, [{ status: 'BOOKED', linkedQuantity: 2 }])).toBe('0/2 shipped')
    expect(
      progressLabel(20, [
        { status: 'ARRIVED', linkedQuantity: 10 },
        { status: 'BOOKED', linkedQuantity: 10 },
      ]),
    ).toBe('10/20 shipped')
  })

  it('uses the allocated quantity as denominator when the PO total is unknown', () => {
    expect(progressLabel(null, [{ status: 'DEPARTED', linkedQuantity: 4 }])).toBe('4/4 shipped')
    expect(progressLabel(null, [{ status: 'SAILED', linkedQuantity: 4 }])).toBe('0/4 shipped') // Final BOL ≠ shipped
  })

  it('falls back to the furthest badge label when no quantities exist', () => {
    expect(progressLabel(100, [{ status: 'BOOKED' }, { status: 'AT_WAREHOUSE' }])).toBe('Draft BOL')
    expect(progressLabel(null, [{ status: 'DEPARTED' }])).toBe('Departure')
  })

  it('says cancelled when every shipment is cancelled, and — with no shipments', () => {
    expect(progressLabel(2, [{ status: 'CANCELLED', linkedQuantity: 2 }])).toBe('cancelled')
    expect(progressLabel(2, [])).toBe('—')
  })
})

describe('furthestStatusLabel — the list speaks the BADGE vocabulary (document stages)', () => {
  it('returns the furthest shipment status with the badge label', () => {
    expect(furthestStatusLabel([{ status: 'BOOKED', linkedQuantity: 2 }])).toBe('Booking Request')
    expect(furthestStatusLabel([{ status: 'BOOKED' }, { status: 'AT_WAREHOUSE' }])).toBe('Draft BOL')
    expect(furthestStatusLabel([{ status: 'SAILED' }])).toBe('Final BOL')
    expect(furthestStatusLabel([{ status: 'DEPARTED' }])).toBe('Departure')
    expect(furthestStatusLabel([{ status: 'RELEASED' }])).toBe('Departure') // raw synonym
    expect(furthestStatusLabel([{ status: 'ARRIVED' }])).toBe('Delivered')
  })
  it('handles cancelled-only and empty', () => {
    expect(furthestStatusLabel([{ status: 'CANCELLED' }])).toBe('Cancelled')
    expect(furthestStatusLabel([])).toBe('—')
  })
})
