// frontend/src/lib/qty-conflict-settle.test.ts
import { describe, it, expect } from 'vitest'
import type { CriticConflict } from './critic-review'
import {
  normalizeQty,
  isQtyConflict,
  isQtySettled,
  filterActionableConflicts,
  poShipmentTotalFromLinked,
  existingQtyDisplay,
} from './qty-conflict-settle'

function qtyConflict(
  candidates: { value: string; source: string }[],
): CriticConflict {
  return {
    field: 'qty',
    label: 'Total Quantity',
    candidates,
    rationale: 'test',
  }
}

describe('normalizeQty', () => {
  it('parses integers and strings', () => {
    expect(normalizeQty(16)).toBe(16)
    expect(normalizeQty('16')).toBe(16)
    expect(normalizeQty(' 16 cartons ')).toBe(16) // leading number
    expect(normalizeQty(null)).toBeNull()
    expect(normalizeQty('')).toBeNull()
  })
})

describe('isQtySettled', () => {
  it('S1: live equals non-system candidate', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '16', source: 'Final B/L' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: null })).toBe(true)
  })

  it('S2: live equals PO shipment total when non-system only stale', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '5', source: 'Booking Request' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: 16 })).toBe(true)
  })

  it('S3: all candidates equal live', () => {
    const c = qtyConflict([
      { value: '16', source: 'system' },
      { value: '16', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: null })).toBe(true)
  })

  it('shows when live differs from non-system and PO total', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '100', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: 16, poShipmentTotal: 100 })).toBe(false)
  })

  it('shows when liveQty null', () => {
    const c = qtyConflict([
      { value: '5', source: 'system' },
      { value: '16', source: 'SO' },
    ])
    expect(isQtySettled(c, { liveQty: null, poShipmentTotal: 16 })).toBe(false)
  })
})

describe('poShipmentTotalFromLinked', () => {
  it('prefers sharedBroadcastTotal', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 1, sharedBroadcastTotal: 16 },
        { quantity: 2, sharedBroadcastTotal: 16 },
      ]),
    ).toBe(16)
  })

  it('sums quantity when every PO has a number and no broadcast', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 10, totalQuantity: null },
        { quantity: 6, totalQuantity: null },
      ]),
    ).toBe(16)
  })

  it('null when a PO qty missing', () => {
    expect(
      poShipmentTotalFromLinked([
        { quantity: 10 },
        { quantity: null, totalQuantity: null },
      ]),
    ).toBeNull()
  })
})

describe('filterActionableConflicts', () => {
  it('drops settled qty, keeps other fields', () => {
    const conflicts: CriticConflict[] = [
      qtyConflict([
        { value: '5', source: 'system' },
        { value: '16', source: 'Final B/L' },
      ]),
      {
        field: 'vendor_code',
        label: 'Vendor',
        candidates: [
          { value: '', source: 'system' },
          { value: 'MACAU', source: 'SO' },
        ],
        rationale: 'x',
      },
    ]
    const out = filterActionableConflicts(conflicts, {
      liveQty: 16,
      poShipmentTotal: 16,
    })
    expect(out.map((c) => c.field)).toEqual(['vendor_code'])
  })
})

describe('existingQtyDisplay', () => {
  it('returns live string when live present', () => {
    const c = qtyConflict([{ value: '5', source: 'system' }])
    expect(existingQtyDisplay(c, 16)).toBe('16')
  })

  it('returns null when no live (caller uses system)', () => {
    const c = qtyConflict([{ value: '5', source: 'system' }])
    expect(existingQtyDisplay(c, null)).toBeNull()
  })
})
