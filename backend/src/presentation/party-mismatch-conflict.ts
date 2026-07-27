/**
 * "The emails name one company; this shipment is linked to another" — as a question the desk can answer.
 *
 * A raw party twin that disagrees with the resolved master used to be display-only: Order Details
 * amber-flagged it ("flag, don't follow") and told the operator to "correct in review", while the
 * review desk carried no item for it at all. So the one surface that named the problem pointed at a
 * surface that could not solve it, and the shipment kept showing a company its own leg did not name
 * (leg 20260405F1: `vendor_raw = ELSMCO`, `booking.vendor_id` still SOUOCE).
 *
 * Turning it into a conflict row gives it the machinery every other field decision already has: both
 * companies offered, the operator picks, and the review write path re-links the master FK to whatever
 * they choose. Nothing is invented — both candidates are values already on the record.
 */
import type { CriticReview } from '../decisions/critic-review.types'

export type PartyMismatchInput = {
  slot: 'customer' | 'vendor'
  /** What the leg's raw twin says — also what the desk shows as Current. */
  raw: string
  masterCode: string
  masterName: string
}

const FIELD_BY_SLOT = {
  customer: { field: 'customer_code', label: 'Customer Code' },
  vendor: { field: 'vendor_code', label: 'Vendor Code' },
} as const

/**
 * Append a pickable row per unresolved party mismatch.
 *
 * Skips a slot the critic ALREADY contests — that row is the live disagreement and carries the
 * email's own candidates; adding a second one for the same field would ask the same question twice
 * with different options.
 *
 * The master is offered as the proposal rather than as the `System` side on purpose: `Current` is
 * read from the leg (openDecisions.liveValues → the raw twin), so the master has to appear as
 * something the operator can APPLY, otherwise the row would show ELSMCO against ELSMCO and read as
 * settled when the link underneath still says SOUOCE.
 */
export function withPartyMismatchConflicts(
  review: CriticReview | null | undefined,
  mismatches: (PartyMismatchInput | null | undefined)[],
): CriticReview | null {
  const open = (mismatches ?? []).filter((m): m is PartyMismatchInput => {
    if (!m) return false
    return m.raw.trim() !== '' && m.masterCode.trim() !== ''
  })
  if (open.length === 0) return review ?? null

  const existing = review?.conflicts ?? []
  const already = new Set(existing.map((c) => c.field))
  const added = open
    .filter((m) => !already.has(FIELD_BY_SLOT[m.slot].field))
    .map((m) => {
      const { field, label } = FIELD_BY_SLOT[m.slot]
      return {
        field,
        label,
        candidates: [
          {
            // The NAME is what the row prints; the master's code rides alongside as the chip and is
            // what a pick actually posts (resolutionValueOf). Putting the code in both made the cell
            // read "SOUOCESOUOCE".
            value: m.masterName?.trim() || m.masterCode,
            source: 'Master data',
            master: { code: m.masterCode, name: m.masterName },
          },
        ],
        rationale: `The emails name "${m.raw}", but this shipment is linked to ${m.masterCode} — ${m.masterName}. Pick the company it really is.`,
      }
    })
  if (added.length === 0) return review ?? null

  // A leg with no critic payload still deserves the question, so synthesise the minimum shape.
  if (!review) {
    return { conflicts: added } as unknown as CriticReview
  }
  return { ...review, conflicts: [...existing, ...added] } as CriticReview
}
