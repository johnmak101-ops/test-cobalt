import { sql, type Kysely } from 'kysely'

/**
 * 0010 — `shipments.vendor_raw` (nvarchar(500) NULL): the parser's raw `vendor_code`, kept
 * unconditionally like `customer_raw` (0008) / `forwarder_raw` — surfaced by the UI when the
 * vendor code doesn't resolve to a master vendor. Without it, an extracted vendor_code (e.g. SOUOCE)
 * is silently dropped and "Vendor Code" shows (pending) even though the parser read it. Additive;
 * no backfill (historical rows predate this column).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD vendor_raw nvarchar(500) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS vendor_raw`).execute(db)
}
