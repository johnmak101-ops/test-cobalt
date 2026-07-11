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
