import { sql, type Kysely } from 'kysely'

/**
 * 0024 — `shipments.cartons` (float NULL): the CARTON count, kept beside `qty`.
 *
 * When a packing table states BOTH cartons and pieces, `qty` takes the pieces (#197 — ops decide on
 * pieces; cartons alone understates), so the carton count had nowhere to live. The queue parser has
 * always extracted it (table-extract.ts emits `fields.cartons` exactly in that both-stated case), but
 * the merge allowlist silently dropped it, so that code had never had any effect and the number was
 * lost every time.
 *
 * Additive, nullable, no backfill — historical rows keep NULL because the value is only recoverable by
 * re-parsing the source email.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD cartons float(53) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS cartons`).execute(db)
}
