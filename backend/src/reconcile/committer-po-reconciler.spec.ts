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
  styleBroadcastSuspected: false,
  styleBroadcastPoCount: null,
  qtyConflict: null,
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

  it('skips PO already on sibling shipment with different HAWB', () => {
    const plan = planPoReconcile({
      pos: ['28739', '28642'],
      fields: { qty: 29, customer_code: 'WYSE', hbl_awb_fcr_no: 'GZL26258522' },
      poQty: {},
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [{ po: '28739', hbl: 'GZL26261147' }],
    })
    const linked = plan.links.map((l) => l.poNo)
    expect(linked).toContain('28642')
    expect(linked).not.toContain('28739')
    expect(plan.poFlagReasons.some((r) => /PO 28739: exclusive to sibling HAWB/i.test(r))).toBe(true)
  })

  it('empty siblingPoHbls does not skip any PO (Set1 single-leg)', () => {
    const plan = planPoReconcile({
      pos: ['28739', '28642'],
      fields: { hbl_awb_fcr_no: 'GZL26258522' },
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [],
    })
    expect(plan.links.map((l) => l.poNo)).toEqual(['28739', '28642'])
  })

  it('does not skip PO when sibling claim is same HAWB', () => {
    const plan = planPoReconcile({
      pos: ['28739'],
      fields: { hbl_awb_fcr_no: 'GZL-2625-8522' },
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [{ po: '28739', hbl: 'GZL26258522' }],
    })
    expect(plan.links.map((l) => l.poNo)).toEqual(['28739'])
  })

  it('cross-MODE sibling claim links the PO and flags for verification (Set6 sea+air split)', () => {
    const plan = planPoReconcile({
      pos: ['1570988'],
      fields: { qty: 3, customer_code: 'ELGC', hbl_awb_fcr_no: 'SZA26050003', mode: 'AIR' },
      poQty: {},
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [{ po: '1570988', hbl: 'SNZ260004243', mode: 'SEA' }],
    })
    expect(plan.links.map((l) => l.poNo)).toContain('1570988')
    expect(plan.poFlagReasons.some((r) => /PO 1570988: also on sibling HAWB SNZ260004243 \(cross-mode split\)/i.test(r))).toBe(true)
    expect(plan.poFlagReasons.some((r) => /exclusive to sibling HAWB/i.test(r))).toBe(false)
  })

  // normMode now collapses every sea variant to SEA, so these values should never reach here.
  // The family collapse is kept as defence-in-depth for legacy rows written before migration 0023
  // and for any caller that bypasses normMode — a granular value must never read as a cross-mode split.
  it('same MODE FAMILY sibling claim still skips (legacy SEA_FCL vs SEA_LCL are one family)', () => {
    const plan = planPoReconcile({
      pos: ['28739'],
      fields: { qty: 29, customer_code: 'WYSE', hbl_awb_fcr_no: 'GZL26258522', mode: 'SEA_FCL' },
      poQty: {},
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [{ po: '28739', hbl: 'GZL26261147', mode: 'SEA_LCL' }],
    })
    expect(plan.links.map((l) => l.poNo)).not.toContain('28739')
    expect(plan.poFlagReasons.some((r) => /PO 28739: exclusive to sibling HAWB/i.test(r))).toBe(true)
  })

  it('missing mode on either side stays conservative (skip)', () => {
    const plan = planPoReconcile({
      pos: ['28739'],
      fields: { qty: 29, hbl_awb_fcr_no: 'GZL26258522' },
      poQty: {},
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
      siblingPoHbls: [{ po: '28739', hbl: 'GZL26261147' }],
    })
    expect(plan.links.map((l) => l.poNo)).not.toContain('28739')
  })

  it('demotes ASNE/packing-line tokens — only real PO is linked (DEMO Set6)', () => {
    const plan = planPoReconcile({
      pos: ['1570988', 'ASNE24054844907', '319001345', '319001552', 'DF2026G031'],
      fields: { so_no: 'S2600144827' },
      poEnrichment: null,
      unattributed: [],
      gk: new Set(),
    })
    expect(plan.links.map((l) => l.poNo)).toEqual(['1570988'])
    expect(plan.poFlagReasons.some((r) => /demoted — packing-line/i.test(r))).toBe(true)
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
    expect(
      isRecomputedDataIssueReason('PO 28739: exclusive to sibling HAWB — not linked'),
    ).toBe(true)
    expect(
      isRecomputedDataIssueReason('PO 1570988: also on sibling HAWB SNZ260004243 (cross-mode split) — linked, verify qty split'),
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
    const fresh = 'PO 16068194: item/style "AAA" vs "BBB" (system read: AAA) — verify'
    const merged = mergeReviewReasonsWithDataIssues([staleStyle, masterMiss], [fresh])
    expect(merged).toEqual([masterMiss, fresh])
    expect(merged.filter((r) => /item(?:_style_no conflict|\/style)/i.test(r))).toHaveLength(1)
    expect(merged.some((r) => /951/.test(r))).toBe(false)
  })

  it('classifies new T2 item/style and T1b copied-style reasons as recomputed', () => {
    expect(
      isRecomputedDataIssueReason(
        'PO 12204: item/style "B0NNIE" vs "BONNIE" (system read: PUH26BHALE) — verify',
      ),
    ).toBe(true)
    expect(
      isRecomputedDataIssueReason(
        'PO 12204: item/style looks copied across all 5 POs of this email — verify per-PO',
      ),
    ).toBe(true)
  })

  it('emits T2-format style conflict (not full list dump)', () => {
    // Map keys are normKey(po) — same as production planPoReconcile lookup
    const map = new Map([
      [
        '12204',
        enr({
          itemStyleNo: 'PUH26BHALE',
          styleConflict: ['B0NNIE, PUH26BHALE', 'BONNIE, PUH26BHALE'],
        }),
      ],
    ])
    const plan = planPoReconcile({
      pos: ['12204'],
      fields: {},
      poEnrichment: map,
      unattributed: [],
      gk: new Set(),
    })
    const r = plan.poFlagReasons.find((x) => /item\/style/i.test(x))
    expect(r).toBeDefined()
    expect(r).toMatch(/PO 12204: item\/style/)
    expect(r).toMatch(/system read: PUH26BHALE/)
    expect(r).not.toMatch(/item_style_no conflict/)
  })

  it('emits T1b style-broadcast flag when enrichment marks it', () => {
    // Map key = normKey('PO-A') → 'POA'
    const map = new Map([
      [
        'POA',
        enr({
          itemStyleNo: 'A, B, C, D, E',
          styleBroadcastSuspected: true,
          styleBroadcastPoCount: 5,
        }),
      ],
    ])
    const plan = planPoReconcile({
      pos: ['PO-A'],
      fields: {},
      poEnrichment: map,
      unattributed: [],
      gk: new Set(),
    })
    expect(
      plan.poFlagReasons.some((r) => /item\/style looks copied across all 5 POs of this email/i.test(r)),
    ).toBe(true)
  })

  it('preserves order of non-recomputed priors and appends new data issues', () => {
    const merged = mergeReviewReasonsWithDataIssues([gateConflict, masterMiss], [staleBrand])
    expect(merged).toEqual([gateConflict, masterMiss, staleBrand])
  })
})
