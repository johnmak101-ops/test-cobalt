/**
 * Pure, stateless field helpers extracted from committer.service.ts (which had grown into a ~700-LOC
 * god file). No I/O — each is a small deterministic transform applied while building a shipment for commit.
 */

/**
 * Does this commit need a human, given the committer's own hints?
 *
 * TWO KINDS of hint, deliberately weighted differently:
 *
 *  - `blocking` — the shipment itself is doubtful (a platform name in the forwarder slot, a bare orphan,
 *    a portal-only mail, the vendor/forwarder guard firing). ALWAYS review, whatever the critic thinks.
 *
 *  - `masterMiss` — the shipment is fine, but a party/port name is not in master data so it was left
 *    unlinked. This is a MASTER-DATA CURATION task, not a shipment review: the reviewer has no action for
 *    it (master-resolved fields are excluded from every editor by design), so Approve would confirm the leg
 *    and leave the field just as unlinked. Gate it on the critic's band: at `high` the critic vouched for
 *    the extraction, so an unmatched name means a MISSING MASTER RECORD → commit confirmed and keep the
 *    reason on the leg as a record. At low/medium the name itself may be garbage → still review.
 *
 * Without the band gate a high-confidence leg with zero risk flags lands in the queue purely because a
 * forwarder is missing from master data (7 of 28 provisionals when this was written), and BOTH the gate
 * and the band had already said `confirmed` — the override was silently discarding the agent's verdict.
 */
export function needsHumanReview(opts: {
  band: string | null | undefined
  blocking: string[]
  masterMiss: string[]
}): boolean {
  if (opts.blocking.length > 0) return true
  return opts.masterMiss.length > 0 && opts.band !== 'high'
}

/** Dedupe a comma-joined list (order-preserving, case-insensitive) — style/HTS lists pile up across the
 *  multiple PO sheets + B/L rider, so the same value repeats. Applied at commit so it holds without a reparse. */
export const dedupeCsv = (s: string | null): string | null => {
  if (!s || !s.includes(',')) return s
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const k = t.toUpperCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.length ? out.join(',') : s
}

/** One hop of the journey chain, as `shipments.journey` stores it (migration 0031). */
export type JourneyLeg = { seq: number; mode: string; pol: string; pod: string; doc: string | null }

/** `shipments.journey` is nvarchar(2000). `String.length` and nvarchar capacity are both counted in
 *  UTF-16 code units, so this comparison is exact rather than a byte-estimate — even for
 *  supplementary-plane characters, where a surrogate pair costs 2 in both. */
export const JOURNEY_MAX_CHARS = 2000

/**
 * Serialise the journey chain for `shipments.journey`, or null if it cannot be stored intact.
 *
 * 🔴 ALL-OR-NOTHING, deliberately. This used to be `JSON.stringify(legs).slice(0, 2000)`, which has two
 * failure modes and picks the worse one:
 *
 *  - slicing a JSON *string* cuts mid-token, so the column holds text no reader can parse. `journeyRoute`
 *    swallows that and returns null, so the route silently vanishes with nothing pointing at why.
 *  - dropping trailing legs to make it fit would parse — and then LIE. The chain IS the route: a stored
 *    `PVG→DEL` when the cargo actually went `PVG→DEL→LHR` renders as a confident, complete, wrong answer.
 *    Truncating prose loses detail; truncating a route changes the destination.
 *
 * So an over-long chain stores null, and the reader falls back to the resolved pol/pod codes — the
 * pre-0031 behaviour, less specific but never wrong (see `field-catalog.spec.ts`, "route prefers the
 * journey chain, falls back to resolved port codes"). The caller logs the drop so it is not silent.
 *
 * For scale: the real corpus serialises ~57 chars per leg (~69 with a doc number), so the cap is ~29
 * hops. Nothing legitimate reaches that — a chain that does is a malformed `groupJourney`, and null plus
 * a warning is the honest response to it.
 */
export function serializeJourney(legs: JourneyLeg[] | null | undefined): string | null {
  if (!legs?.length) return null
  const out = JSON.stringify(legs)
  return out.length <= JOURNEY_MAX_CHARS ? out : null
}
