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
