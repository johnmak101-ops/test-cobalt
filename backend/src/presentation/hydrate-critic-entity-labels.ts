/**
 * Extraction / merge often stores Mesh master *codes* on entity fields (e.g. forwarder_name
 * "058" / "060"). The conflict table was showing those raw codes; operators need company names.
 *
 * Pure response-time hydrate — does not rewrite stored critic_review. When a candidate value
 * matches a master code exactly (case-insensitive), replace the display value with the name.
 */
import type { CriticConflict, CriticReview } from '../decisions/critic-review.types'

export type EntityCodeNameMaps = {
  forwarderByCode: Map<string, string>
  customerByCode?: Map<string, string>
  vendorByCode?: Map<string, string>
}

function lookupForField(field: string, maps: EntityCodeNameMaps): Map<string, string> | undefined {
  const f = field.trim().toLowerCase()
  if (f === 'forwarder_name' || f === 'forwarder' || f === 'forwarderraw') return maps.forwarderByCode
  if (f === 'customer_code' || f === 'customer' || f === 'customerraw') return maps.customerByCode
  if (f === 'vendor_code' || f === 'vendor' || f === 'vendorraw') return maps.vendorByCode
  return undefined
}

/** Resolve one candidate/value: code → master name when known; otherwise leave as-is. */
export function resolveEntityDisplayValue(
  field: string,
  value: string,
  maps: EntityCodeNameMaps,
): string {
  const v = String(value ?? '').trim()
  if (!v) return value
  const map = lookupForField(field, maps)
  if (!map) return value
  const name = map.get(v.toUpperCase())
  if (!name?.trim()) return value
  // Already a name (or same string) — no change.
  if (name.trim().toUpperCase() === v.toUpperCase()) return value
  return name.trim()
}

function hydrateConflict(c: CriticConflict, maps: EntityCodeNameMaps): CriticConflict {
  return {
    ...c,
    candidates: c.candidates.map((cand) => ({
      ...cand,
      value: resolveEntityDisplayValue(c.field, cand.value, maps),
    })),
  }
}

/** proposedChanges entries use priorValue / proposedValue — hydrate entity fields the same way. */
function hydrateProposedChange(
  raw: unknown,
  maps: EntityCodeNameMaps,
): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const row = raw as Record<string, unknown>
  const field = typeof row.field === 'string' ? row.field : ''
  if (!lookupForField(field, maps)) return raw
  const next = { ...row }
  if (typeof row.priorValue === 'string' && row.priorValue.trim()) {
    next.priorValue = resolveEntityDisplayValue(field, row.priorValue, maps)
  }
  if (typeof row.proposedValue === 'string' && row.proposedValue.trim()) {
    next.proposedValue = resolveEntityDisplayValue(field, row.proposedValue, maps)
  }
  return next
}

/**
 * Return a shallow-cloned CriticReview with entity codes expanded to master names in
 * conflicts[] and proposedChanges[]. Null-safe.
 */
export function hydrateCriticEntityLabels(
  cr: CriticReview | null | undefined,
  maps: EntityCodeNameMaps,
): CriticReview | null {
  if (!cr) return null
  const hasConflicts = Array.isArray(cr.conflicts) && cr.conflicts.length > 0
  const hasProposed = Array.isArray(cr.proposedChanges) && cr.proposedChanges.length > 0
  if (!hasConflicts && !hasProposed) return cr

  return {
    ...cr,
    conflicts: hasConflicts
      ? cr.conflicts!.map((c) => hydrateConflict(c, maps))
      : cr.conflicts,
    proposedChanges: hasProposed
      ? cr.proposedChanges.map((p) => hydrateProposedChange(p, maps))
      : cr.proposedChanges,
  }
}

/** Build code→name maps from master rows that may carry `code`. */
export function entityCodeNameMapsFromRefs(
  forwarders: Iterable<{ code?: string | null; name: string }>,
  customers?: Iterable<{ code?: string | null; name: string }>,
  vendors?: Iterable<{ code?: string | null; name: string }>,
): EntityCodeNameMaps {
  const toMap = (rows: Iterable<{ code?: string | null; name: string }> | undefined) => {
    const m = new Map<string, string>()
    if (!rows) return m
    for (const r of rows) {
      const code = (r.code ?? '').trim()
      const name = (r.name ?? '').trim()
      if (!code || !name) continue
      m.set(code.toUpperCase(), name)
    }
    return m
  }
  return {
    forwarderByCode: toMap(forwarders),
    customerByCode: toMap(customers),
    vendorByCode: toMap(vendors),
  }
}
