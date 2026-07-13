import { sql, type Kysely } from 'kysely'

/**
 * 0008 — `shipments.customer_raw` (nvarchar(500) NULL): the parser's raw `customer_code`, kept
 * unconditionally like `forwarder_raw`/`pol_raw`/`pod_raw` — surfaced by the UI when `customerId`
 * doesn't resolve to a master customer (see committer-leg-mapping.ts, shipment.mapper.ts). Without
 * this, an unresolved customer code is silently dropped: `shipment_parties.customer_code` exists but
 * is only written when the primary code DOES resolve (writeParties bails out on an unresolved primary),
 * so it can't serve as the fallback. Additive; no backfill (historical rows predate this column).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD customer_raw nvarchar(500) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS customer_raw`).execute(db)
}
