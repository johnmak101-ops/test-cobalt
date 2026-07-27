/**
 * Phase ① (ShipTrack half) — hold the queue's candidate list to the same rule the committer uses.
 *
 * Two matchers run over the same email and never speak. The queue's emits `matchAmbiguity` with N
 * candidate legs; ShipTrack's `findExistingLeg` decides independently and, on the dev queue, created a
 * new leg 179 times out of 181. Both results are recorded, neither is reconciled, and the desk renders
 * the queue's uncertainty beside the committer's decision as though they were one thing.
 *
 * The committer is not being arbitrary when it refuses. Its rule is `strongKeysConflict` (BUG 4): a leg
 * that states a DIFFERENT value for an identity type the email also states is a DIFFERENT shipment, and
 * must never be amended. Two distinct B/L numbers are two distinct consignments — one SO routinely
 * carries many house bills.
 *
 * The queue's candidate list is not held to that rule. Measured: **45 of 62 offered candidates (73%)**
 * carry a B/L or booking that conflicts with the email's own — 43 on `hbl_awb_fcr_no`, 2 on
 * `booking_no`. Every one of them is a leg the committer already refused, offered to an operator as
 * something to merge into. Taking that offer writes one shipment's data onto another.
 *
 * So: refuse them here too, with the reason attached. This is deliberately the committer's EXISTING
 * predicate rather than a new heuristic — a candidate the committer would not amend is not a candidate.
 *
 * Note what this is NOT: it does not decide identity, and it never says "this leg is the right one".
 * It only removes the ones already ruled out. An earlier attempt (#378) tried to settle identity by
 * comparing the email's key to the leg's own and was circular, because a leg the committer CREATED
 * carries the email's key by construction. This looks only at OTHER legs, so that trap cannot recur.
 */
import { strongKeysConflict } from '../reconcile/committer-match'
import { strongKeys } from '../reconcile/match-keys'
import type { CriticReview } from '../decisions/critic-review.types'

/** The strong-key-bearing shape both sides expose (queue candidate rows and the email key bag). */
type KeyBag = {
  so_no?: string | null
  booking_no?: string | null
  hbl_awb_fcr_no?: string | null
  mbl?: string | null
  container_no?: string | null
}

export type RefusedCandidate = {
  shipmentId: string
  /** The identity type that clashes — `hbl_awb_fcr_no`, `booking_no`, … */
  onKey: string
  emailValue: string
  candidateValue: string
}

export type CandidateReconciliation = {
  /** Candidates the committer would be willing to amend — the only ones worth offering. */
  usable: string[]
  /** Ruled out, with the clash named so the reason survives into the UI and the audit. */
  refused: RefusedCandidate[]
}

const KEYS: (keyof KeyBag)[] = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']

/** The first identity type both sides state with different values, or null when they can coexist. */
export function conflictingKey(
  email: KeyBag,
  /** Callers pass whole candidate rows, which carry an id and other display fields. */
  candidate: KeyBag & { shipmentId?: string },
): RefusedCandidate['onKey'] | null {
  for (const k of KEYS) {
    const a = String(email[k] ?? '').trim()
    const b = String(candidate[k] ?? '').trim()
    if (!a || !b) continue
    if (strongKeysConflict(strongKeys({ [k]: a }), strongKeys({ [k]: b }))) return k
  }
  return null
}

/**
 * Split the queue's candidates into the ones the committer would consider and the ones it has already
 * ruled out. Candidates carrying no comparable key stay usable — absence is not a conflict, and this
 * function's job is to remove the impossible, never to pick a winner.
 */
export function reconcileQueueCandidates(
  emailKey: KeyBag | null | undefined,
  candidates: ({ shipmentId: string } & KeyBag)[] | null | undefined,
): CandidateReconciliation {
  const list = candidates ?? []
  if (!emailKey) return { usable: list.map((c) => c.shipmentId), refused: [] }

  const usable: string[] = []
  const refused: RefusedCandidate[] = []
  for (const c of list) {
    const key = conflictingKey(emailKey, c)
    if (key) {
      refused.push({
        shipmentId: c.shipmentId,
        onKey: key,
        emailValue: String(emailKey[key] ?? '').trim(),
        candidateValue: String(c[key] ?? '').trim(),
      })
    } else {
      usable.push(c.shipmentId)
    }
  }
  return { usable, refused }
}

/**
 * Drop the ruled-out candidates from a critic payload, keeping WHY on the payload so the desk can say
 * "3 more matched but state a different B/L" instead of silently showing fewer options.
 *
 * When fewer than two survive there is no choice left to present, so the ambiguity signal goes with
 * them — the same treatment `stripStaleAmbiguousSignals` already gives a lookup that no longer
 * multi-hits.
 */
export function withUsableCandidatesOnly(
  criticReview: CriticReview | null | undefined,
): CriticReview | null | undefined {
  const ma = criticReview?.matchAmbiguity
  if (!criticReview || !ma || (ma.candidates?.length ?? 0) < 2) return criticReview

  const { usable, refused } = reconcileQueueCandidates(ma.emailKey, ma.candidates)
  if (refused.length === 0) return criticReview

  const keep = new Set(usable)
  const candidates = (ma.candidates ?? []).filter((c) => keep.has(c.shipmentId))

  if (candidates.length < 2) {
    // Nothing left to choose between — drop the picker and the flag that summoned it, exactly as
    // stripStaleAmbiguousSignals does for a lookup that no longer multi-hits.
    const { matchAmbiguity: _drop, ...rest } = criticReview
    return {
      ...rest,
      riskFlags: (criticReview.riskFlags ?? []).filter((f) => f?.code !== 'AMBIGUOUS_MATCH'),
      refusedCandidates: refused,
    }
  }
  return { ...criticReview, matchAmbiguity: { ...ma, candidates }, refusedCandidates: refused }
}
