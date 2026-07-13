/**
 * PoQtyReconciler — pure plan for per-PO link + review flags, extracted from CommitterService.apply.
 * Side effects (upsertPo / linkPo) stay in the committer; this module only DECIDES qty, unit, enrichment
 * payload, and the review-reason strings so the rules stay unit-testable without a DB.
 */
import { keysOverlap, strongKeys, normKey, str, num } from './match-keys'
import { type PoEnrichment, type UnattributedStatement } from './po-enrichment'
import { poQtyIssue, describePoQtyIssue } from './po-qty-consistency'

export interface PoLinkPlan {
  poNo: string
  perPoQty: number | null
  perPoUnit: string | null
  enr: PoEnrichment | null | undefined
}

export interface PoReconcilePlan {
  links: PoLinkPlan[]
  poQtyIssues: string[]
  poFlagReasons: string[]
}

/**
 * Build the per-PO link plan + review-flag reasons for one commit group.
 * Semantics match the previous inline loop in CommitterService.apply (byte-stable reason strings).
 */
export function planPoReconcile(args: {
  pos: string[]
  fields: Record<string, unknown>
  poQty?: Record<string, number>
  poEnrichment: Map<string, PoEnrichment> | null
  unattributed: UnattributedStatement[]
  /** strongKeys(g.matchKeys) — unattributed statements only flag when they share identity with the group */
  gk: Set<string>
}): PoReconcilePlan {
  const { pos, fields, poQty, poEnrichment, unattributed, gk } = args
  const poQtyIssues: string[] = []
  const poFlagReasons: string[] = []
  const links: PoLinkPlan[] = []

  for (const poNo of pos) {
    const mapped = num(poQty?.[normKey(poNo)])
    const perPoQty = mapped ?? (pos.length === 1 ? num(fields.qty) : null)
    const perPoUnit = str(fields.qty_unit) // no code-side default — a missing unit stays null
    const enr = poEnrichment?.get(normKey(poNo))
    const qctx = {
      legQty: perPoQty,
      legUnit: perPoUnit,
      poTotal: enr?.totalQuantity ?? null,
      poUnit: enr?.quantityUnit ?? null,
    }
    const issue = poQtyIssue(qctx)
    if (issue) poQtyIssues.push(`PO ${poNo}: ${describePoQtyIssue(issue, qctx)}`)
    // Broadcast totals (same carton count on every PO) are normal for multi-PO bookings — the UI shows
    // a single shipment cargo total, not per-PO order qty. Keep the value on purchase_orders; do NOT
    // review-flag (enr.broadcastSuspected still drives sharedBroadcastTotal presentation only).
    if (enr?.brandConflict)
      poFlagReasons.push(`PO ${poNo}: brand conflict ${enr.brandConflict.join(' vs ')} (kept ${enr.brand}) — verify`)
    if (enr?.styleConflict)
      poFlagReasons.push(
        `PO ${poNo}: item_style_no conflict ${enr.styleConflict.join(' vs ')} (kept ${enr.itemStyleNo}) — verify`,
      )
    links.push({ poNo, perPoQty, perPoUnit, enr })
  }

  // de-correction (b2 no-PO): brand/style with NO PO — flag when identity overlaps, never leak onto every PO.
  const poGotBrand = pos.some((p) => poEnrichment?.get(normKey(p))?.brand != null)
  const poGotStyle = pos.some((p) => poEnrichment?.get(normKey(p))?.itemStyleNo != null)
  const seenUnattributed = new Set<string>()
  for (const u of unattributed) {
    if (u.field === 'brand' && poGotBrand) continue
    if (u.field === 'item_style_no' && poGotStyle) continue
    if (!keysOverlap(strongKeys(u.matchKeys), gk)) continue
    const dedupe = `${u.field}:${u.value}`
    if (seenUnattributed.has(dedupe)) continue
    seenUnattributed.add(dedupe)
    poFlagReasons.push(`shipment-level ${u.field} "${u.value}" not attributed to any PO — verify per-PO ${u.field}`)
  }

  return { links, poQtyIssues, poFlagReasons }
}
