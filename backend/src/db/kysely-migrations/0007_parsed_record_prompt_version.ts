import { sql, type Kysely } from 'kysely'

/**
 * 0007 — `parsed_record.prompt_version` (int NULL): the cobalt-queue soul version (queue.prompt_version.id)
 * that produced this parse, carried on POST /api/decisions evidence[] (queue v1, §4.6d). Provenance only —
 * lets incident review answer "show shipments parsed under soul vN". Additive + optional: older queues
 * omit it and the column stays null. No backfill (historical rows predate queue-side versioning).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE parsed_record ADD prompt_version int NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE parsed_record DROP COLUMN IF EXISTS prompt_version`).execute(db)
}
