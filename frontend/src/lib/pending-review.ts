import { mapCriticFieldToColumn, conflictColumns } from './review-fields'

/**
 * The slice of the shipment detail this derivation reads. Structural on purpose — importing
 * ShipmentDetail from hooks/ would point a lib module at the data layer.
 */
export interface PendingReviewSource {
  reviewStatus?: string | null
  reviewReasons?: string[]
  criticReview?: { conflicts?: Array<{ field: string }> } | null
  contestedLocks?: Array<{ field: string }> | null
}

/**
 * Reasons that state a genuine disagreement. reviewReasons also carries system-decision notes
 * ("ETD set to departure date …") whose prose names columns; parsing those would amber-light a
 * field nobody has a question about, so only conflict-flavoured reasons feed conflictColumns.
 */
const CONFLICT_REASON_RE = /conflict|disagree|differ|already stored on|locked field/i

/**
 * Leg columns with something OPEN against them, for the Order Details word-highlight
 * (.review-pending-value): the union of
 *   - critic conflicts while the shipment is still provisional (approving/dismissing the review
 *     item flips reviewStatus, so the highlight clears itself), and
 *   - contested locks, which stay until Keep/Restore regardless of review status.
 * Unknown critic fields are dropped, not invented — same rule as mapCriticFieldsToColumns.
 */
export function pendingReviewColumns(
  shipment: PendingReviewSource | null | undefined,
): Set<string> {
  const cols = new Set<string>()
  if (!shipment) return cols
  if (shipment.reviewStatus === 'provisional') {
    for (const c of shipment.criticReview?.conflicts ?? []) {
      const col = mapCriticFieldToColumn(c.field)
      if (col) cols.add(col)
    }
    const conflictReasons = (shipment.reviewReasons ?? []).filter((r) =>
      CONFLICT_REASON_RE.test(r),
    )
    for (const col of conflictColumns(conflictReasons)) cols.add(col)
  }
  for (const lock of shipment.contestedLocks ?? []) {
    cols.add(mapCriticFieldToColumn(lock.field) ?? lock.field)
  }
  return cols
}
