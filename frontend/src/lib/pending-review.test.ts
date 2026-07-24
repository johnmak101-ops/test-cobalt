import { describe, it, expect } from 'vitest'
import { pendingReviewColumns, pendingReviewAnnotations } from './pending-review'

const critic = (fields: string[]) => ({ conflicts: fields.map((field) => ({ field })) })

describe('pendingReviewColumns — which Order Details columns carry something open for review', () => {
  it('maps provisional critic conflicts to leg columns (snake_case parser names included)', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      criticReview: critic(['etd', 'qty_unit', 'hbl_awb_fcr_no', 'booking_no']),
    })
    expect(cols).toEqual(new Set(['etd', 'qtyUnit', 'hblAwbFcrNo', 'bookingNo']))
  })

  it('drops critic fields that map to no leg column instead of inventing one', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      criticReview: critic(['customer_po', 'totally_unknown_field']),
    })
    expect(cols.size).toBe(0)
  })

  it('ignores critic conflicts once the review is no longer provisional', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'confirmed',
      criticReview: critic(['etd']),
    })
    expect(cols.size).toBe(0)
  })

  it('always includes contested locks, even after approval', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'confirmed',
      contestedLocks: [{ field: 'etd' }, { field: 'qtyUnit' }],
    })
    expect(cols).toEqual(new Set(['etd', 'qtyUnit']))
  })

  it('parses conflict-flavoured review reasons into columns (Order Details vocabulary only)', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      reviewReasons: ['backend conflict on qty, gross_weight, measurement'],
    })
    // gross_weight / measurement are not on the Order Details form — never highlighted there.
    expect(cols).toEqual(new Set(['qty']))
  })

  it('does not light fields from system-decision notes that merely mention a column', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      reviewReasons: ['ETD set to departure date 2026-02-08 (booking estimate was 2026-02-06)'],
    })
    expect(cols.size).toBe(0)
  })

  it('returns an empty set for a missing shipment', () => {
    expect(pendingReviewColumns(undefined).size).toBe(0)
    expect(pendingReviewColumns(null).size).toBe(0)
  })
})

describe('pendingReviewAnnotations — warn tooltips read as operator instructions', () => {
  it('humanizes the per-PO-dropped units conflict into a "please verify" line', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [
        'PO 1570988: qty 3 stated under conflicting units (cartons vs packages vs pieces) — per-PO qty dropped',
      ],
    })
    expect(ann.get('qty')?.level).toBe('warn')
    expect(ann.get('qty')?.messages[0]).toBe(
      'Quantity stated under conflicting units (cartons vs packages vs pieces) — the per-PO figure was dropped. Please verify.',
    )
  })
})
