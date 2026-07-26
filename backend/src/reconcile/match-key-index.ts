/**
 * Pure derivation of the queryable strong-key index rows for a leg — the persisted form of
 * `strongKeys(matchKeys)`. Extracted so the parse is unit-tested in isolation; the committer's thin shell
 * reads the group's already-computed keys, calls this, and persists the rows (delete+insert per shipment).
 *
 * WHY it exists: `findExistingLeg` / matcher lookup match a leg on `strongKeys(l.matchKeys)`. Persisting the
 * SAME keys (same source, same normalization) into an indexed `(type,value)` table lets `candidateLegs`
 * (`WHERE (type,value) IN gk` ∪ shared-PO) be a PROVABLE SUPERSET of the strong-overlap match — so the
 * allLegs() scan is replaced without missing a leg (which would mint a duplicate). Write side here;
 * readers: committer.apply (INCREMENT 2) + ShipmentsService.lookupByMatchKey (INCREMENT 3).
 */
import type { Insertable } from 'kysely'
import type { DB } from '../db/kysely/db'
import { strongKeys } from './match-keys'

type MatchKeyRow = Insertable<DB['shipmentMatchKeys']>

/** One normalized row per strong key (`booking_no`/`so_no`/`hbl_awb_fcr_no`/`mbl`/`container_no`), value
 *  already `normKey`-folded (booking_no revision-stripped) exactly as `strongKeys` does. `customer_po` and
 *  `conversation_id` are not strong keys and are never indexed. Empty/absent keys yield no row. */
export function matchKeyIndexRows(
  shipmentId: string,
  matchKeys: Record<string, unknown> | null | undefined,
): MatchKeyRow[] {
  const rows: MatchKeyRow[] = []
  for (const tv of strongKeys(matchKeys)) {
    const i = tv.indexOf(':')
    rows.push({ shipmentId, type: tv.slice(0, i) as MatchKeyRow['type'], value: tv.slice(i + 1) })
  }
  return rows
}

/**
 * Fold an incoming decision's match keys onto the leg's stored bag: per-TYPE overwrite, absent/empty
 * incoming values leave the stored value standing.
 *
 * 🔴 Why this exists. `findExistingLeg` matches on `strongKeys(leg.matchKeys)` — the leg's STORED bag — while
 * the committer used to rebuild the index from `g.matchKeys` ALONE via delete+insert. On the amend path the
 * leg's `match_keys` column is never rewritten, so the two drifted in BOTH directions. Observed live on
 * 2026-07-26 for one shipment: stored JSON `{booking_no: CA771, hbl_awb_fcr_no: A26050003, …}` while the index
 * held `hbl_awb_fcr_no=SZA26050003, mbl=…` and **no `CA771` at all**. That silently breaks this module's
 * header claim that the index is a PROVABLE SUPERSET of the strong-overlap match: a later decision keyed on
 * `booking_no=CA771` could not retrieve the leg from `candidateLegs`, so `findExistingLeg` never saw it and a
 * duplicate leg would be inserted — the same outcome as the AWB-alias defect, a different cause.
 *
 * Per-type overwrite is deliberately the SAME rule as `syncIdentityMatchKeys` (the human-edit path in
 * `shipments/identity-keys.ts`), which already does `{ ...leg.matchKeys, ...keyPatch }` and rebuilds from the
 * result. Both paths therefore leave one invariant true: `shipment_match_keys == strongKeys(match_keys)`.
 *
 * This is NOT a blanket union: a CORRECTED identity must replace the old value for its type, or the leg would
 * keep attracting mail to a value it no longer has. Supersession of a whole LEG stays where it already lives —
 * `findSupersededByIdentityCorrection` retires the zombie; it was never this index's job.
 */
export function mergeIdentityKeys(
  stored: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(stored ?? {}) }
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    merged[k] = v
  }
  return merged
}
