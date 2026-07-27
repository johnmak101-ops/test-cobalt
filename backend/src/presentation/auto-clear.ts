/**
 * Legs that reach the desk with nothing left for a human to decide.
 *
 * A review gate fires when an email lands. By the time an operator opens the card, a later email may
 * already have applied the very value that was flagged — so the card renders its "ready state" and the
 * only control on it is `Confirm Reviewed`. That click communicates nothing: the operator did not
 * choose a value, did not verify anything, and had nothing to act on. It is pure queue tax.
 *
 * So these legs stop reaching the Active desk. The queue reports them as a group ("3 legs cleared
 * themselves") rather than dropping them silently.
 *
 * ── Two deliberate design choices ───────────────────────────────────────────────────────────────
 *
 * 1. NOTHING IS WRITTEN. The leg stays `provisional`; it is filtered from the pending view, exactly as
 *    `isHighBandAutoEligible` already filters high-band legs. This is not laziness — it is the safer
 *    semantics. A leg auto-confirmed into `confirmed` is gone for good, whereas a leg merely filtered
 *    RETURNS to the desk by itself the moment a new email puts a real conflict on it. "Nothing to
 *    decide" is a statement about right now, and it must be allowed to stop being true.
 *
 *    It also keeps the agent's calibration honest: no `approved` outcome is recorded, because no human
 *    approved anything.
 *
 * 2. UNKNOWN MEANS VISIBLE. Every test below is a reason to CLEAR; anything unrecognised keeps the leg
 *    on the desk. A leg wrongly shown costs one click. A leg wrongly hidden is a shipment nobody
 *    checked, so the failure modes are not symmetric and the default is not either.
 */
import type { CriticReview } from '../decisions/critic-review.types'
import { openDecisions } from './open-decisions'

/**
 * Reasons that exist ONLY to point at the conflict table. When every conflict they point at is
 * settled, they have nothing left to say.
 *
 * Kept in step with the `conflict` category in the frontend's review-reasons.ts. Deliberately narrow:
 * a reason that is not on this list is treated as real work, so adding to it is the only way to widen
 * what auto-clears — and that is a decision, not an accident.
 */
const CONFLICT_ONLY_REASON: RegExp[] = [
  /^backend conflict on /i,
  /\d+\s*unresolved field conflict/i,
  /\d+\s*field conflict\(s\)/i,
  /received different values/i,
  /disagrees with what.s already on the shipment/i,
  /^conflicting_identifiers$/i,
]

/** Audit strings the desk never shows a human, so they cannot be the reason a leg stays queued. */
const SILENT_REASON: RegExp[] = [
  /subject-party-pin|subject-party-veto/i,
  /identity_fallback/i,
]

const isSilent = (r: string): boolean => SILENT_REASON.some((re) => re.test(r))
const isConflictOnly = (r: string): boolean => CONFLICT_ONLY_REASON.some((re) => re.test(r))

export type AutoClearVerdict =
  | { clear: false }
  /** `why` is shown to the operator on the cleared-group strip — never a bare count. */
  | { clear: true; why: string }

/**
 * @param leg      the leg AS STORED (camelCase columns) — the same shape openDecisions() reads
 * @param review   the critic payload for this leg
 * @param reasons  review reasons, already port-filtered by the caller
 */
export function autoClearVerdict(
  leg: Record<string, unknown>,
  review: CriticReview | null | undefined,
  reasons: string[],
): AutoClearVerdict {
  const speaking = (reasons ?? []).map((r) => String(r ?? '').trim()).filter((r) => r !== '' && !isSilent(r))
  const conflicts = review?.conflicts ?? []

  // Any reason that is not purely about the conflict table is real work — stop here.
  if (speaking.some((r) => !isConflictOnly(r))) return { clear: false }

  /**
   * Everything else the desk can raise a question about, and which no reason string covers. A leg
   * carrying any of these still has something to look at even with a clean reason list.
   */
  if (hasOpenCandidatePicker(review)) return { clear: false }

  if (conflicts.length === 0) {
    // No conflicts AND no speaking reasons: the gate's grounds are gone entirely.
    return speaking.length === 0
      ? { clear: true, why: 'nothing was flagged on this leg' }
      : { clear: false }
  }

  const { settledFields } = openDecisions(leg, review, {})
  const settled = new Set(settledFields)
  const unsettled = conflicts.filter((c) => !settled.has(c.field))
  if (unsettled.length > 0) return { clear: false }

  return {
    clear: true,
    why:
      conflicts.length === 1
        ? 'the one flagged value already matches the shipment'
        : `all ${conflicts.length} flagged values already match the shipment`,
  }
}

/**
 * A leg the queue offered alternative shipments for still needs a human to say which — the conflict
 * rows being settled does not answer it.
 */
function hasOpenCandidatePicker(review: CriticReview | null | undefined): boolean {
  const ma = (review as { matchAmbiguity?: { candidates?: unknown[] } } | null | undefined)
    ?.matchAmbiguity
  return (ma?.candidates?.length ?? 0) >= 2
}
