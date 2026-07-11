import { describe, it, expect } from 'vitest'
import { planPoReconcile } from './committer-po-reconciler'
import { strongKeys } from './match-keys'
import type { PoEnrichment } from './po-enrichment'

const enr = (over: Partial<PoEnrichment> = {}): PoEnrichment => ({
  brand: null,
  itemStyleNo: null,
  totalQuantity: null,
  quantityUnit: null,
  broadcastSuspected: false,
  brandConflict: null,
  styleConflict: null,
  ...over,
})

describe('planPoReconcile (PoQtyReconciler pure plan)', () => {
  it('flags a broadcast-suspected total with the stable reason string', () => {
    const map = new Map([['POBA', enr({ totalQuantity: 168, quantityUnit: 'cartons', broadcastSuspected: true })]])
    const plan = planPoReconcile({
      pos: ['PO-BA'],
      fields: {},
      poEnrichment: map,
      unattributed: [],
      gk: new Set(),
    })
    expect(plan.poFlagReasons.some((r) => /broadcast total/i.test(r))).toBe(true)
    expect(plan.links[0].enr?.totalQuantity).toBe(168)
  })

  it('flags a brand conflict and keeps the planned enrichment', () => {
    const map = new Map([['POCONF', enr({ brand: 'FENIX', brandConflict: ['FENIX', 'Barbour'] })]])
    const plan = planPoReconcile({
      pos: ['PO-CONF'],
      fields: {},
      poEnrichment: map,
      unattributed: [],
      gk: new Set(),
    })
    expect(plan.poFlagReasons.some((r) => /brand conflict/i.test(r))).toBe(true)
  })

  it('flags unattributed shipment-level brand when strong keys overlap', () => {
    const plan = planPoReconcile({
      pos: ['PO-U'],
      fields: {},
      poEnrichment: new Map([['POU', enr({ itemStyleNo: 'ABC' })]]),
      unattributed: [{ field: 'brand', value: 'Barbour', matchKeys: { so_no: 'SO-U' } }],
      gk: strongKeys({ so_no: 'SO-U' }),
    })
    expect(plan.poFlagReasons.some((r) => /not attributed to any PO/i.test(r))).toBe(true)
  })

  it('does NOT flag unattributed brand when a PO already has brand', () => {
    const plan = planPoReconcile({
      pos: ['PO-U'],
      fields: {},
      poEnrichment: new Map([['POU', enr({ brand: 'FENIX' })]]),
      unattributed: [{ field: 'brand', value: 'Barbour', matchKeys: { so_no: 'SO-U' } }],
      gk: strongKeys({ so_no: 'SO-U' }),
    })
    expect(plan.poFlagReasons.some((r) => /not attributed/i.test(r))).toBe(false)
  })

  it('single-PO group falls back to shipment-level qty for the link plan', () => {
    const plan = planPoReconcile({
      pos: ['PO-1'],
      fields: { qty: '12', qty_unit: 'cartons' },
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
    })
    expect(plan.links[0]).toMatchObject({ perPoQty: 12, perPoUnit: 'cartons' })
  })
})
