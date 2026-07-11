import { sql, type Kysely } from 'kysely'

/**
 * 0004 — the queryable NORMALIZED PO index (`purchase_orders.po_number_norm`), the PO-half prerequisite for
 * removing the `allLegs()` full-scan in the committer (TODO "Ingest N+1 — INCREMENT 2, read-side swap").
 *
 * `findExistingLeg` matches a PO-only leg on a SHARED PO, comparing `normKey(po_number)` on BOTH sides (it
 * strips non-alphanumerics + upper-cases, so 'FEL-GZ-OSA-2842' == 'FEL GZ OSA 2842' == 'FELGZOSA2842'). The
 * stored `po_number` is RAW, so a candidate query matching the raw column would MISS a leg whose PO was stored
 * with different punctuation — a false-negative that mints a duplicate shipment. Persisting the SAME normalized
 * key the matcher compares, indexed, makes the candidate query `WHERE po_number_norm IN groupPos` a PROVABLE
 * SUPERSET of the shared-PO match (mirrors what 0003 did for the strong keys).
 *
 * It is (re)written on every PO write by PurchaseOrderRepository (upsertPo/createPo/updatePo); the read-side
 * swap is a separate increment. Backfilling it is inert on live behavior (nothing reads it until the swap).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE purchase_orders ADD po_number_norm nvarchar(100) NULL`).execute(db)
  await sql.raw(`CREATE INDEX ix_purchase_orders_po_number_norm ON purchase_orders (po_number_norm)`).execute(db)
  await backfill(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP INDEX IF EXISTS ix_purchase_orders_po_number_norm ON purchase_orders`).execute(db)
  await sql.raw(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS po_number_norm`).execute(db)
}

/**
 * Populate the normalized key for every existing PO from its `po_number`. The normalization is a FROZEN inline
 * copy of `normKey` (match-keys.ts) — a migration must stay reproducible and must not drift if that app code
 * later changes; new writes go through the live code via the repository. Empty on a fresh DB / prod (Fabric
 * ShipTrackDB provisioned empty).
 */
async function backfill(db: Kysely<unknown>): Promise<void> {
  const normKey = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const res = await sql<{ id: string; poNumber?: string; po_number?: string }>`select id, po_number from purchase_orders`.execute(db)
  const anyDb = db as unknown as Kysely<{ purchaseOrders: { id: string; poNumberNorm: string } }>
  for (const r of res.rows) {
    const norm = normKey(r.poNumber ?? r.po_number)
    await anyDb.updateTable('purchaseOrders').set({ poNumberNorm: norm }).where('id', '=', r.id).execute()
  }
}
