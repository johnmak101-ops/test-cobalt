/**
 * Extraction / merge often stores Mesh master *codes* on entity fields (e.g. forwarder_name
 * "058" / "060"). The conflict table was showing those raw codes; operators need company names.
 *
 * Pure response-time hydrate — does not rewrite stored critic_review. Two jobs:
 *   · value display: when a candidate value matches a master code exactly (case-insensitive),
 *     replace the display value with the name (unchanged behavior);
 *   · master attachment: party candidates additionally carry `master: {code, name}` (resolved via
 *     code or exact normalized name), or `master: null` when a letter-bearing value has no master
 *     ("not in Mesh"). Absent = no claim: non-party field, numeric leak, or ambiguous name.
 *     The candidate `value` (what Approve commits) is never the concatenated chip text.
 */
import type { CriticConflict, CriticReview } from '../decisions/critic-review.types'
import { isNonPartyName } from '../decisions/critic-review.types'

type MasterEntry = { code: string; name: string }

type EntityKind = 'forwarder' | 'customer' | 'vendor'

export type EntityCodeNameMaps = {
  forwarderByCode: Map<string, MasterEntry>
  customerByCode?: Map<string, MasterEntry>
  vendorByCode?: Map<string, MasterEntry>
  /** Normalized master name → entry; `null` marks an ambiguous name (two masters collide). */
  forwarderByName?: Map<string, MasterEntry | null>
  customerByName?: Map<string, MasterEntry | null>
  vendorByName?: Map<string, MasterEntry | null>
}

function entityKindForField(field: string): EntityKind | undefined {
  const f = field.trim().toLowerCase()
  if (f === 'forwarder_name' || f === 'forwarder' || f === 'forwarderraw') return 'forwarder'
  if (f === 'customer_code' || f === 'customer' || f === 'customerraw') return 'customer'
  if (f === 'vendor_code' || f === 'vendor' || f === 'vendorraw') return 'vendor'
  return undefined
}

function codeMapFor(kind: EntityKind, maps: EntityCodeNameMaps) {
  if (kind === 'forwarder') return maps.forwarderByCode
  if (kind === 'customer') return maps.customerByCode
  return maps.vendorByCode
}

function nameMapFor(kind: EntityKind, maps: EntityCodeNameMaps) {
  if (kind === 'forwarder') return maps.forwarderByName
  if (kind === 'customer') return maps.customerByName
  return maps.vendorByName
}

/** Same spirit as the repository's norm_exact tier, but Unicode-aware so CJK names survive.
 *  Shared with the mapper's party-mismatch check — one normalization, one answer. */
export function normalizeEntityName(s: string): string {
  return s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Resolve one candidate/value: code → master name when known; otherwise leave as-is. */
export function resolveEntityDisplayValue(
  field: string,
  value: string,
  maps: EntityCodeNameMaps,
): string {
  const v = String(value ?? '').trim()
  if (!v) return value
  const kind = entityKindForField(field)
  if (!kind) return value
  const name = codeMapFor(kind, maps)?.get(v.toUpperCase())?.name
  if (!name?.trim()) return value
  // Already a name (or same string) — no change.
  if (name.trim().toUpperCase() === v.toUpperCase()) return value
  return name.trim()
}

/**
 * Resolve a party value to its Mesh master.
 *   entry     — resolved by code or unique normalized name
 *   null      — letter-bearing value with no master: genuinely "not in Mesh"
 *   undefined — no claim: non-party field, empty, numeric leak (isNonPartyName), ambiguous name
 */
export function resolveEntityMaster(
  field: string,
  value: string,
  maps: EntityCodeNameMaps,
): MasterEntry | null | undefined {
  const kind = entityKindForField(field)
  if (!kind) return undefined
  const v = String(value ?? '').trim()
  if (!v) return undefined
  const codeHit = codeMapFor(kind, maps)?.get(v.toUpperCase())
  if (codeHit) return codeHit
  const key = normalizeEntityName(v)
  if (key.length >= 3) {
    const nameHit = nameMapFor(kind, maps)?.get(key)
    if (nameHit) return nameHit
    if (nameHit === null) return undefined
  }
  // A "party" with no letter in any script is a leaked PO/booking/container number, not a
  // company — same guard as the Mesh-miss worklist; never claim "not in Mesh" for it.
  if (isNonPartyName(v)) return undefined
  return null
}

/**
 * Vendor/customer values shown under a "Code" label (detail-row change history): prefer the master
 * CODE for any value that resolves (code or exact name); unresolved raw text stays as written.
 * Forwarder/port kinds excluded — their rows display names, and codes like "058" are unreadable.
 */
export function resolveEntityCodeDisplay(
  field: string,
  value: string,
  maps: EntityCodeNameMaps,
): string {
  const kind = entityKindForField(field)
  if (kind !== 'customer' && kind !== 'vendor') return value
  const v = String(value ?? '').trim()
  if (!v) return value
  const code = resolveEntityMaster(field, v, maps)?.code?.trim()
  return code || value
}

function hydrateConflict(c: CriticConflict, maps: EntityCodeNameMaps): CriticConflict {
  return {
    ...c,
    candidates: c.candidates.map((cand) => {
      const value = resolveEntityDisplayValue(c.field, cand.value, maps)
      const master = resolveEntityMaster(c.field, cand.value, maps)
      return master === undefined ? { ...cand, value } : { ...cand, value, master }
    }),
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
  if (!entityKindForField(field)) return raw
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

/** Build code→entry and normalized-name→entry maps from master rows that may carry `code`. */
export function entityCodeNameMapsFromRefs(
  forwarders: Iterable<{ code?: string | null; name: string }>,
  customers?: Iterable<{ code?: string | null; name: string }>,
  vendors?: Iterable<{ code?: string | null; name: string }>,
): EntityCodeNameMaps {
  const toMaps = (rows: Iterable<{ code?: string | null; name: string }> | undefined) => {
    const byCode = new Map<string, MasterEntry>()
    const byName = new Map<string, MasterEntry | null>()
    if (!rows) return { byCode, byName }
    for (const r of rows) {
      const code = (r.code ?? '').trim()
      const name = (r.name ?? '').trim()
      if (!code || !name) continue
      const entry: MasterEntry = { code, name }
      byCode.set(code.toUpperCase(), entry)
      const key = normalizeEntityName(name)
      if (key.length < 3) continue
      const prev = byName.get(key)
      if (prev === undefined) byName.set(key, entry)
      else if (!(prev && prev.code === entry.code)) byName.set(key, null)
    }
    return { byCode, byName }
  }
  const fwd = toMaps(forwarders)
  const cust = toMaps(customers)
  const vend = toMaps(vendors)
  return {
    forwarderByCode: fwd.byCode,
    forwarderByName: fwd.byName,
    customerByCode: cust.byCode,
    customerByName: cust.byName,
    vendorByCode: vend.byCode,
    vendorByName: vend.byName,
  }
}
