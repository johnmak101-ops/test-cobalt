/**
 * PoQtyReconciler — pure plan for per-PO link + review flags, extracted from CommitterService.apply.
 * Side effects (upsertPo / linkPo) stay in the committer; this module only DECIDES qty, unit, enrichment
 * payload, and the review-reason strings so the rules stay unit-testable without a DB.
 */
import { keysOverlap, strongKeys, normKey, str, num } from './match-keys'
import { type PoEnrichment, type UnattributedStatement, summarizeStyleConflict } from './po-enrichment'
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
/** Other legs' PO↔HAWB claims used as defense-in-depth against cross-HAWB PO linking. */
export type SiblingPoHbl = { po: string; hbl: string }

export function planPoReconcile(args: {
  pos: string[]
  fields: Record<string, unknown>
  poQty?: Record<string, number>
  poEnrichment: Map<string, PoEnrichment> | null
  unattributed: UnattributedStatement[]
  /** strongKeys(g.matchKeys) — unattributed statements only flag when they share identity with the group */
  gk: Set<string>
  /**
   * POs already linked on sibling shipments with a different HAWB. Empty / omitted → no filter
   * (Set1 single-leg unchanged). When this leg has an HBL and a PO is claimed by a different HBL,
   * skip linking that PO and flag for review.
   */
  siblingPoHbls?: SiblingPoHbl[]
}): PoReconcilePlan {
  const { pos, fields, poQty, poEnrichment, unattributed, gk } = args
  const poQtyIssues: string[] = []
  const poFlagReasons: string[] = []
  const links: PoLinkPlan[] = []
  const myHbl = normKey(fields.hbl_awb_fcr_no)
  const siblings = args.siblingPoHbls ?? []

  for (const poNo of pos) {
    // Defense-in-depth: queue matcher prunes cross-HAWB POs; committer also skips if a sibling
    // shipment already owns this PO under a different HBL (multi-HAWB split / Set5).
    if (
      myHbl &&
      siblings.some(
        (s) => normKey(s.po) === normKey(poNo) && normKey(s.hbl) && normKey(s.hbl) !== myHbl,
      )
    ) {
      poFlagReasons.push(`PO ${poNo}: exclusive to sibling HAWB — not linked`)
      continue
    }
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
    // T2: symmetric-diff style conflict copy (not full multi-list dump)
    if (enr?.styleConflict)
      poFlagReasons.push(`PO ${poNo}: ${summarizeStyleConflict(enr.styleConflict, enr.itemStyleNo)}`)
    // T1b: multi-token style copied across ≥3 POs of one email (flag only)
    if (enr?.styleBroadcastSuspected) {
      const n = enr.styleBroadcastPoCount ?? 3
      poFlagReasons.push(
        `PO ${poNo}: item/style looks copied across all ${n} POs of this email — verify per-PO`,
      )
    }
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

/**
 * Reasons owned by the post-link data-issues pass (planPoReconcile + cargo-missing).
 * These must be RECOMPUTED each commit — never accumulated from prior review_reasons.
 * Without this, a resolved OCR style family (#124) leaves "item_style_no conflict … kept 951"
 * on the leg forever when the leg is not re-amended, or when merge is prior ∪ current.
 */
export function isRecomputedDataIssueReason(reason: string): boolean {
  const r = String(reason)
  // brand / item_style enrichment conflicts (planPoReconcile poFlagReasons)
  if (/^PO\s+\S+:\s*brand conflict\b/i.test(r)) return true
  // old format (pre-T2) + new T2 "item/style …" + T1b "item/style looks copied"
  if (/^PO\s+\S+:\s*item_style_no conflict\b/i.test(r)) return true
  if (/^PO\s+\S+:\s*item\/style\b/i.test(r)) return true
  // unattributed shipment-level brand/style
  if (/^shipment-level (brand|item_style_no)\b/i.test(r)) return true
  // per-PO qty vs ERP order (planPoReconcile poQtyIssues)
  if (/^PO\s+\S+:\s*unit differs:/i.test(r)) return true
  if (/^PO\s+\S+:\s*shipped .+ exceeds ordered\b/i.test(r)) return true
  // cross-HAWB PO exclusivity (planPoReconcile sibling skip)
  if (/^PO\s+\S+:\s*exclusive to sibling HAWB\b/i.test(r)) return true
  // empty cargo escalation (committer)
  if (/booked shipment missing cargo detail/i.test(r)) return true
  return false
}

/**
 * Merge gate/master reasons with the current data-issues pass.
 * Drops any prior recomputed data-issue strings, then appends the fresh set (deduped).
 * Gate / master-miss / critic reasons that are not recomputed here are preserved.
 */
export function mergeReviewReasonsWithDataIssues(
  priorReasons: string[] | null | undefined,
  dataIssues: string[],
): string[] {
  const kept = (priorReasons ?? []).filter((r) => !isRecomputedDataIssueReason(r))
  return [...new Set([...kept, ...dataIssues])]
}
