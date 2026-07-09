/**
 * Pure shipment_identifiers row derivation, extracted from committer.writeIdentifiers so the subtle history
 * rules (cross-type dedup, co-current is_current) are unit-tested in isolation. No I/O — the committer's thin
 * writeIdentifiers shell reads the leg, calls these, and persists the rows.
 */
import type * as schema from '../db/contracts'
import { normKey } from './match-keys'

type IdentifierRow = typeof schema.shipmentIdentifiers.$inferInsert
type Identifier = {
  type: string
  value: string
  docType?: string | null
  rank?: number | null
  isCurrent?: boolean
  sourceEmailId?: string | null
  observedAt?: string | null
}

/** identity field → the leg COLUMN that holds its committed value. */
const COL = { so_no: 'soNo', booking_no: 'bookingNo', hbl_awb_fcr_no: 'hblAwbFcrNo', mbl: 'mbl', container_no: 'containerNo' } as const

/** The alnum value each identity COLUMN currently holds on the leg (type → normKey) — lets a human-locked /
 *  committed primary stay is_current regardless of the agent. */
export function currentIdentifierValues(leg: Record<string, unknown>): Record<string, string> {
  const current: Record<string, string> = {}
  for (const [type, col] of Object.entries(COL)) {
    const v = leg[col]
    if (v != null && v !== '') current[type] = normKey(v)
  }
  return current
}

/**
 * Build the shipment_identifiers rows from the agent's identifier list + the leg's current column values.
 * CO-CURRENT semantics: a value is `is_current` when it is the agent-marked co-current member OR equals the
 * ACTUAL committed column (keeps a human-locked primary current regardless of the agent).
 * 7b cross-type dedup: the SAME value can arrive under several identity types (a booking number echoed as an
 * SO number, an MBL echoed as an HBL). Keep each alnum-equal value only under its highest-priority type
 * (booking_no > mbl > hbl_awb_fcr_no > so_no), then dedup by type:value. Idempotent (delete+insert upstream).
 */
export function deriveIdentifierRows(
  shipmentId: string,
  identifiers: Identifier[],
  current: Record<string, string>,
): IdentifierRow[] {
  const TYPE_PRIORITY: Record<string, number> = { booking_no: 0, mbl: 1, hbl_awb_fcr_no: 2, so_no: 3 }
  const bestTypeForValue = new Map<string, string>()
  for (const id of identifiers) {
    if (!id.value || !(id.type in COL)) continue
    const rank = TYPE_PRIORITY[id.type]
    if (rank === undefined) continue // container_no etc. — not cross-type deduped
    const av = normKey(id.value)
    const cur = bestTypeForValue.get(av)
    if (cur === undefined || rank < (TYPE_PRIORITY[cur] ?? Infinity)) bestTypeForValue.set(av, id.type)
  }
  const seen = new Set<string>()
  return identifiers
    .filter((id) => id.value && id.type in COL)
    .filter((id) => {
      // drop a prioritizable value that is being kept under a higher-priority type
      if (id.type in TYPE_PRIORITY) {
        const winner = bestTypeForValue.get(normKey(id.value))
        if (winner && winner !== id.type) return false
      }
      return true
    })
    .filter((id) => {
      const k = `${id.type}:${id.value}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((id) => ({
      shipmentId,
      type: id.type as IdentifierRow['type'],
      value: id.value,
      docType: id.docType ?? null,
      rank: id.rank ?? null,
      isCurrent: current[id.type] === normKey(id.value) || id.isCurrent === true,
      sourceEmailId: id.sourceEmailId ?? null,
      observedAt: id.observedAt ? new Date(id.observedAt) : null,
    }))
}
