import { sql, type Kysely } from 'kysely'

/**
 * 0030 — `shipments.factory_code` (nvarchar NULL).
 *
 * The MANUFACTURER, split out of `vendor_code` on the queue side. The field has merged on both sides
 * since the FIELD_CLASS parity change ('list' — an LCL consol carries one factory per shipper), but
 * nothing stored it, so it merged and evaporated.
 *
 * 🔴 BACKEND DATA ONLY, by decision 2026-08-03: stored for queries and audit; the frontend does not
 * display it. Per the labelling ground truth (`03-labelled_emails_DEMO`) a factory is also a legitimate
 * `vendor_code` in its own right, so this column records an ADDITIONAL fact about the shipment and must
 * never be read as "the real vendor".
 *
 * Same shape as 0026 (net_weight): additive, nullable, no backfill — historical rows keep NULL because
 * the value is only recoverable by re-parsing the source email. Comma-joined list, same as
 * item_style_no; sized to hold several factory names, not just codes (the queue routes LATIN factory
 * names here too, e.g. `GLORY APPAREL (CAMBODIA) CO., LTD` in four punctuation spellings).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD factory_code nvarchar(800) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS factory_code`).execute(db)
}
