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

/** Legal-form / generic tokens carrying no identity — excluded from the token-overlap signal. */
const NAME_STOPWORDS = new Set([
  'CO', 'COMPANY', 'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'LLC', 'CORP', 'CORPORATION',
  'GMBH', 'AG', 'SA', 'PLC', 'PTE', 'PVT', 'SDN', 'BHD', 'THE', 'AND', '&',
  '有限公司', '公司',
])

/** CJK company names run with no delimiter between the org name and its legal-form suffix (no spaces
 *  in Chinese), so the per-word split below can never isolate '有限公司'/'公司' as their own token —
 *  strip them as substrings first. Built from NAME_STOPWORDS (longest-first) so the two lists can't drift.
 *  Guarded: if the filtered list were ever empty, `new RegExp('', 'g')` would match everywhere and shred
 *  CJK tokenization silently — only build the regex when there's at least one CJK stopword. */
const cjkStops = [...NAME_STOPWORDS].filter((w) => /[一-鿿]/.test(w)).sort((a, b) => b.length - a.length)
const CJK_STOPWORD_RE = cjkStops.length ? new RegExp(cjkStops.join('|'), 'g') : null

export function nameTokens(s: string): Set<string> {
  const out = new Set<string>()
  let cleaned = s.toUpperCase().replace(/[^A-Z0-9一-鿿]+/g, ' ')
  if (CJK_STOPWORD_RE) cleaned = cleaned.replace(CJK_STOPWORD_RE, ' ')
  cleaned = cleaned.trim()
  for (const t of cleaned.split(/\s+/)) {
    if (t.length >= 2 && !NAME_STOPWORDS.has(t)) out.add(t)
  }
  return out
}

/** Token-overlap recall signal (all-AI spec §3): master tokens ⊆ input tokens, or Jaccard ≥ 0.5.
 *  Rescues short master names ('DSV') that trigram similarity under-scores against long raws. */
export function tokenMatch(input: string, master: string): boolean {
  const a = nameTokens(input)
  const b = nameTokens(master)
  if (!a.size || !b.size) return false
  let inter = 0
  for (const t of b) if (a.has(t)) inter++
  if (inter === b.size) return true
  return inter / (a.size + b.size - inter) >= 0.5
}

/** REVERSE subset — input tokens ⊆ master tokens. The city-name→airport recall direction found by the
 *  2026-07-10 live probe: raw 'SHANGHAI' must surface 'Shanghai Pudong International Airport' so the LLM
 *  can pick by mode. Applied to the PORT kind only (small namespace); opening it for parties would flood
 *  candidates with every master containing a common city token. */
export function tokenSubset(input: string, master: string): boolean {
  const a = nameTokens(input)
  const b = nameTokens(master)
  if (!a.size || !b.size) return false
  for (const t of a) if (!b.has(t)) return false
  return true
}
