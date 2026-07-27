/**
 * "The email already told us which shipment it means."
 *
 * A leg is flagged AMBIGUOUS_MATCH when an email matched more than one existing leg — and that match
 * runs on `so_no`, which every leg of one sales order shares. On SO S13784413 that is **11 legs**, so
 * "matched more than one" is true by construction and the desk asks "which shipment?" on every single
 * one of them.
 *
 * Meanwhile the email carried `hbl_awb_fcr_no: FCR001379073`, and the leg being reviewed already held
 * exactly that HBL — uniquely in the table. The strongest key available had answered the question
 * before it was asked. Nobody re-checked, so the desk offered five OTHER legs to choose from (the
 * panel excludes the leg you are on) and marked one of them `suggested` because its vessel and ETD
 * happened to match. Taking that suggestion would have folded the leg into the wrong shipment.
 *
 * So: when the email's own strong key names THIS leg, there is nothing to pick.
 */
import type { MatchAmbiguity, MatchAmbiguityCandidate } from './critic-review'

/**
 * Keys that IDENTIFY a leg, in decreasing authority.
 *
 * `so_no` is deliberately absent: it is the key that caused the false ambiguity, being shared by every
 * leg of an order. `container_no` is absent for the same reason and more explicitly — a 拼櫃 (shared
 * container) is by definition carried by several bookings, and this very leg's panel warned about
 * MRSU4743377 being shared. Neither can pin anything on its own.
 */
const IDENTIFYING_KEYS: { key: string; legField: string; label: string }[] = [
  { key: 'hbl_awb_fcr_no', legField: 'hblNumber', label: 'HBL' },
  { key: 'mbl', legField: 'mblNumber', label: 'MBL' },
  { key: 'booking_no', legField: 'bookingNo', label: 'booking no.' },
]

/**
 * Compare-only normalisation. Nothing stored is rewritten — this decides whether two strings NAME the
 * same thing, exactly as the case-insensitive vessel comparison elsewhere does.
 *
 * The edge-punctuation trim exists for a real leg: the email stated booking `#TN#1075317470#BKG` and
 * the leg holds `TN#1075317470#BKG` — the same booking, differing by one leading `#` that came off a
 * label ("#" as in "no."). Only LEADING and TRAILING punctuation is dropped; the separators inside the
 * value are load-bearing and stay, so two genuinely different bookings cannot collapse into one.
 */
function norm(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
}

export type EmailKeyPin = {
  /** Which key settled it — 'HBL', 'MBL', 'booking no.'. */
  label: string
  /** The value both the email and this leg carry. */
  value: string
}

/**
 * The email's strong key names this leg, and no offered candidate carries the same value.
 *
 * The second half matters and is the only part we can actually verify client-side: "unique in the
 * database" is not knowable here, but "unique among the legs the matcher itself put forward" is — and
 * that is the set the operator would otherwise be choosing from. If a candidate shared the value there
 * would be a real choice to make, and the panel stays.
 */
export function emailKeyPinsThisLeg(
  matchAmbiguity: MatchAmbiguity | null | undefined,
  leg: Record<string, unknown> | null | undefined,
): EmailKeyPin | null {
  if (!matchAmbiguity || !leg) return null
  const emailKey = matchAmbiguity.emailKey
  if (!emailKey) return null
  const candidates: MatchAmbiguityCandidate[] = matchAmbiguity.candidates ?? []

  for (const { key, legField, label } of IDENTIFYING_KEYS) {
    const fromEmail = norm(emailKey[key])
    if (!fromEmail) continue
    const onLeg = norm(leg[legField])
    if (!onLeg || onLeg !== fromEmail) continue
    const sharedByCandidate = candidates.some(
      (c) => norm((c as unknown as Record<string, unknown>)[key]) === fromEmail,
    )
    if (sharedByCandidate) return null
    return { label, value: String(emailKey[key]).trim() }
  }
  return null
}
