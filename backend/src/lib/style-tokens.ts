/**
 * Shared style-token helpers (zero deps). Used by po-enrichment (pick/union)
 * and purchase-order.repository (upsertPo superset-upgrade) without db↔reconcile
 * import cycles.
 */

/** Normalized token set (upper, trimmed) for set ops. */
export function styleTokenSet(raw: string): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.toUpperCase()),
  )
}

/**
 * True when candidate's token set is a proper superset of existing
 * (more tokens, every existing token present). Used to upgrade PO
 * itemStyleNo without shrinking or replacing with disjoint labels.
 */
export function isStyleTokenSuperset(candidate: string, existing: string): boolean {
  const c = styleTokenSet(candidate)
  const e = styleTokenSet(existing)
  if (c.size <= e.size) return false
  return [...e].every((t) => c.has(t))
}

/**
 * Bare PO refs mis-filed as styles (Customs/HAWB "P028642", "PO28630").
 * Pure digit styles (43079) and PO/style slash pairs (4483262/LKN…) stay —
 * only the P0/PO-prefixed side of a slash pair is garbage.
 */
export function isPoShapedStyleToken(token: string): boolean {
  const t = String(token ?? '')
    .trim()
    .replace(/\s+/g, '')
  if (!t) return true
  return /^P0?\d{4,}$/i.test(t) || /^PO\d{4,}$/i.test(t)
}

/** Drop PO-shaped tokens from a comma list; null if nothing real remains. */
export function scrubPoShapedStyles(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const kept: string[] = []
  for (const entry of s.split(/[,;，]+/).map((x) => x.trim()).filter(Boolean)) {
    const sides = entry
      .split('/')
      .map((x) => x.trim())
      .filter((x) => x && !isPoShapedStyleToken(x))
    if (sides.length) kept.push(sides.join('/'))
  }
  return kept.length ? kept.join(', ') : null
}

/** True when every token is PO-shaped (safe to overwrite with a real style). */
export function isEntirelyPoShapedStyle(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return false
  const parts = String(raw)
    .split(/[,;，/]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every(isPoShapedStyleToken)
}
