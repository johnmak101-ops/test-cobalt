import { sql, type Kysely } from 'kysely'

/**
 * 0018 — `shipments.warehouse_so` (nvarchar(200) NULL): 入仓/订仓 SO number from warehouse-in
 * docs, stored separately from carrier `so_no` / booking_no. Display-only column; never dual-written
 * into so_no or booking_no. Same width as so_no. Additive; no backfill.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD warehouse_so nvarchar(200) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS warehouse_so`).execute(db)
}
