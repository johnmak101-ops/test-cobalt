/**
 * pg_trgm-compatible trigram similarity, in TypeScript (T-SQL re-spec 2026-07-10: SQL Server /
 * Fabric has no pg_trgm and Full-Text is a poor fit for short-name fuzzy match; the master sets are
 * an ERP mirror of a few thousand rows, so scoring app-side is exact, portable, and unit-testable).
 *
 * Semantics mirror pg_trgm so the design's ~0.3 threshold carries over: lowercase, strip to
 * [a-z0-9 ], split on whitespace, pad each word with two leading spaces + one trailing space,
 * collect 3-grams into a SET, score |A ∩ B| / |A ∪ B|.
 */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  const clean = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim()
  if (!clean) return out
  for (const word of clean.split(/\s+/)) {
    const padded = `  ${word} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

/** Jaccard similarity of the two trigram sets — 0 (disjoint) .. 1 (identical). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const g of ta) if (tb.has(g)) inter++
  return inter / (ta.size + tb.size - inter)
}
