import { describe, it, expect } from 'vitest'
import {
  planPoReconcile,
  isRecomputedDataIssueReason,
  mergeReviewReasonsWithDataIssues,
} from './committer-po-reconciler'
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
  it('does NOT review-flag a broadcast-suspected total (shipment total is normal; UI shows it once)', () => {
    const map = new Map([['POBA', enr({ totalQuantity: 168, quantityUnit: 'cartons', broadcastSuspected: true })]])
    const plan = planPoReconcile({
      pos: ['PO-BA'],
      fields: {},
      poEnrichment: map,
      unattributed: [],
      gk: new Set(),
    })
    expect(plan.poFlagReasons.some((r) => /broadcast total/i.test(r))).toBe(false)
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

describe('mergeReviewReasonsWithDataIssues (recompute, do not accumulate)', () => {
  const staleStyle =
    'PO 16068194: item_style_no conflict W56FS007951, W56FS007851 vs W56FS007PS1, W56FS007ES1 (kept W56FS007951, W56FS007851) — verify'
  const staleBrand = 'PO 16068194: brand conflict FENIX vs Barbour (kept FENIX) — verify'
  const masterMiss =
    'forwarder_name "VENA SAIL (BD) SUPPLY CHAIN CO. LTD." did not exact-match a master (LLM matcher owns fuzzy; left unlinked)'
  const gateConflict = 'backend conflict on qty, item_style_no'

  it('classifies enrichment / qty / cargo reasons as recomputed', () => {
    expect(isRecomputedDataIssueReason(staleStyle)).toBe(true)
    expect(isRecomputedDataIssueReason(staleBrand)).toBe(true)
    expect(
      isRecomputedDataIssueReason(
        'shipment-level brand "Barbour" not attributed to any PO — verify per-PO brand',
      ),
    ).toBe(true)
    expect(isRecomputedDataIssueReason('PO X: unit differs: shipped in cartons, ordered in pieces')).toBe(
      true,
    )
    expect(isRecomputedDataIssueReason('PO X: shipped 100 exceeds ordered 50')).toBe(true)
    expect(
      isRecomputedDataIssueReason(
        'booked shipment missing cargo detail (qty/weight/volume) — source attachment likely not ingested',
      ),
    ).toBe(true)
    expect(isRecomputedDataIssueReason(masterMiss)).toBe(false)
    expect(isRecomputedDataIssueReason(gateConflict)).toBe(false)
  })

  it('strips stale style conflict when current dataIssues is empty (#124 rematch)', () => {
    const merged = mergeReviewReasonsWithDataIssues([masterMiss, staleStyle, gateConflict], [])
    expect(merged).toEqual([masterMiss, gateConflict])
    expect(merged.some((r) => /item_style_no conflict/i.test(r))).toBe(false)
  })

  it('replaces old style conflict with a fresh one (does not keep both)', () => {
    const fresh =
      'PO 16068194: item_style_no conflict AAA vs BBB (kept AAA) — verify'
    const merged = mergeReviewReasonsWithDataIssues([staleStyle, masterMiss], [fresh])
    expect(merged).toEqual([masterMiss, fresh])
    expect(merged.filter((r) => /item_style_no conflict/i.test(r))).toHaveLength(1)
    expect(merged.some((r) => /951/.test(r))).toBe(false)
  })

  it('preserves order of non-recomputed priors and appends new data issues', () => {
    const merged = mergeReviewReasonsWithDataIssues([gateConflict, masterMiss], [staleBrand])
    expect(merged).toEqual([gateConflict, masterMiss, staleBrand])
  })
})
