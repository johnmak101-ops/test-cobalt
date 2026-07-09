/**
 * Pure, stateless field helpers extracted from committer.service.ts (which had grown into a ~700-LOC
 * god file). No I/O — each is a small deterministic transform applied while building a shipment for commit.
 */

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
