/**
 * Allow source_type='review' on change_log — Review Queue decisions were indistinguishable from
 * Order Details edits (both wrote 'manual'), so the history could not say where a human acted.
 * SQL Server CHECK constraints must be dropped and recreated to widen the allowed set.
 */
import { type Kysely, sql } from 'kysely'

const SOURCE_TYPES = "'email','manual','system','agent','review'"
const OLD_SOURCE_TYPES = "'email','manual','system','agent'"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE change_log DROP CONSTRAINT ck_change_log_source_type`).execute(db)
  await sql
    .raw(
      `ALTER TABLE change_log ADD CONSTRAINT ck_change_log_source_type CHECK (source_type IN (${SOURCE_TYPES}))`,
    )
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Existing 'review' rows would violate the narrower constraint — fold them back to 'manual' first.
  await sql.raw(`UPDATE change_log SET source_type = 'manual' WHERE source_type = 'review'`).execute(db)
  await sql.raw(`ALTER TABLE change_log DROP CONSTRAINT ck_change_log_source_type`).execute(db)
  await sql
    .raw(
      `ALTER TABLE change_log ADD CONSTRAINT ck_change_log_source_type CHECK (source_type IN (${OLD_SOURCE_TYPES}))`,
    )
    .execute(db)
}
