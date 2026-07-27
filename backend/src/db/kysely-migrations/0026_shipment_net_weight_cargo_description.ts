import { sql, type Kysely } from 'kysely'

/**
 * 0026 — `shipments.net_weight` (float NULL) and `shipments.cargo_description` (nvarchar NULL).
 *
 * `gross_weight` is the PACKED weight (goods + carton); net weight is the goods alone. Customs reads
 * net, freight reads gross, and real booking sheets state the two in ADJACENT columns — so the parser
 * was reading one and dropping the other for want of anywhere to put it. 181 header columns in the
 * live corpus name net weight (NW(kgs) / 系统净重) and 120 name the cargo description (Description of
 * goods / 货描); both topped the queue's unmapped-caption backlog.
 *
 * Same shape as 0024 (cartons): additive, nullable, no backfill — historical rows keep NULL because
 * the value is only recoverable by re-parsing the source email.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD net_weight float(53) NULL`).execute(db)
  await sql.raw(`ALTER TABLE shipments ADD cargo_description nvarchar(1000) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS net_weight`).execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS cargo_description`).execute(db)
}
