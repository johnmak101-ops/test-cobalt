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
