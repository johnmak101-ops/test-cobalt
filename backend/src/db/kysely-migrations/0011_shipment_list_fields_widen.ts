import { sql, type Kysely } from 'kysely'

/**
 * 0011 — widen the two shipment `'list'` fields to nvarchar(max).
 *
 * `item_style_no` and `hts_code` are `'list'`-typed in the queue's critic/merge (they collect every
 * distinct value across a shipment's PO group and comma-join them). Under nvarchar(200)/(500) a big
 * manifest overflowed the column: a 51-PO booking form produced ~600 chars of joined styles and the
 * decision commit 500'd with "String or binary data would be truncated in column 'item_style_no'".
 * The bounded widths contradicted the field semantics; nvarchar(max) matches them (like the existing
 * nvarchar(max) `match_keys` / `review_reasons` on this same table). Neither column is indexed, so the
 * ALTER is safe. Additive/permissive — no data change, nothing that reads them breaks.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ALTER COLUMN item_style_no nvarchar(max) NULL`).execute(db)
  await sql.raw(`ALTER TABLE shipments ALTER COLUMN hts_code nvarchar(max) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // revert to the original bounded widths (may fail if a row now holds a longer value)
  await sql.raw(`ALTER TABLE shipments ALTER COLUMN item_style_no nvarchar(200) NULL`).execute(db)
  await sql.raw(`ALTER TABLE shipments ALTER COLUMN hts_code nvarchar(500) NULL`).execute(db)
}
