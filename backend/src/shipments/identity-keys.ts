import { matchKeyIndexRows } from '../reconcile/match-key-index'

/** Human-editable leg columns that are strong identities ↔ their match-key type
 *  (the STRONG list in reconcile/match-keys.ts). */
export const LEG_COLUMN_TO_KEY: Record<string, string> = {
  bookingNo: 'booking_no',
  soNo: 'so_no',
  hblAwbFcrNo: 'hbl_awb_fcr_no',
  mbl: 'mbl',
  containerNo: 'container_no',
}

interface MatchKeySyncRepo {
  findById(id: string): Promise<{ matchKeys: unknown } | null | undefined>
  updateLeg(id: string, patch: Record<string, unknown>): Promise<unknown>
  replaceMatchKeys(id: string, rows: ReturnType<typeof matchKeyIndexRows>): Promise<unknown>
}

/**
 * After a HUMAN writes a strong-ID column, fold it into the leg's match_keys and rebuild the queryable
 * strong-key index — without this the fixed leg stays invisible to matching and the next email carrying
 * the same identity spawns a duplicate leg. Returns true when anything was synced.
 */
export async function syncIdentityMatchKeys(
  repo: MatchKeySyncRepo,
  shipmentId: string,
  editedColumns: Record<string, unknown>,
): Promise<boolean> {
  const keyPatch: Record<string, unknown> = {}
  for (const [col, key] of Object.entries(LEG_COLUMN_TO_KEY)) {
    const v = editedColumns[col]
    if (v != null && String(v).trim() !== '') keyPatch[key] = v
  }
  if (Object.keys(keyPatch).length === 0) return false
  const leg = await repo.findById(shipmentId)
  const matchKeys = { ...((leg?.matchKeys ?? {}) as Record<string, unknown>), ...keyPatch }
  await repo.updateLeg(shipmentId, { matchKeys })
  await repo.replaceMatchKeys(shipmentId, matchKeyIndexRows(shipmentId, matchKeys))
  return true
}
