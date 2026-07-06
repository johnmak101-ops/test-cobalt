/**
 * PO shipped-qty plausibility. The ERP purchase order (total_quantity + unit) is authoritative; the
 * per-PO SHIPPED qty is attributed by the Matcher and can be wrong — a shipment/SO total broadcast onto
 * every PO, or a qty stated in a different unit than the order. A per-PO shipped qty is INCONSISTENT when:
 *   • it is measured in a different unit than the PO (the magnitudes aren't comparable), or
 *   • (same unit) it exceeds the PO's ordered total — you cannot ship more of a PO than was ordered.
 * Pure + shared: the committer uses it to route such a shipment to review; the presentation layer uses it
 * to flag the offending cell.
 */
export type PoQtyIssue = 'unit_mismatch' | 'exceeds_total'

export interface PoQtyContext {
  legQty: number | null | undefined
  legUnit: string | null | undefined
  poTotal: number | null | undefined
  poUnit: string | null | undefined
}

const normUnit = (u: unknown): string => String(u ?? '').trim().toUpperCase()

/** The inconsistency (if any) between a per-PO shipped qty and its ERP PO. null = consistent / not checkable. */
export function poQtyIssue(ctx: PoQtyContext): PoQtyIssue | null {
  if (ctx.legQty == null) return null // nothing attributed → nothing to check
  const lu = normUnit(ctx.legUnit)
  const pu = normUnit(ctx.poUnit)
  // different units make the magnitudes incomparable — flag the unit, not the (meaningless) excess
  if (lu && pu && lu !== pu) return 'unit_mismatch'
  if (ctx.poTotal != null && ctx.legQty > ctx.poTotal) return 'exceeds_total'
  return null
}

/** Plain-language reason for the flag/tooltip and the review reason. */
export function describePoQtyIssue(issue: PoQtyIssue, ctx: PoQtyContext): string {
  if (issue === 'unit_mismatch')
    return `unit differs: shipped in ${ctx.legUnit ?? '?'}, ordered in ${ctx.poUnit ?? '?'}`
  return `shipped ${ctx.legQty} exceeds ordered ${ctx.poTotal}`
}
