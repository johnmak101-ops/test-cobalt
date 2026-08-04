import { sql, type Kysely } from 'kysely'

/**
 * 0033 — two scan→seek indexes on `shipments`.
 *
 * 1. `conversation_key` — non-persisted computed column over `JSON_VALUE(match_keys, '$.conversation_id')`,
 *    indexed. `legsByConversationId` (the committer's zero-identity adoption lookup, one call per keyed
 *    commit that carries a conversation id) filtered `JSON_VALUE(...)` directly in the WHERE — unsargable,
 *    a full scan of `shipments` per commit. JSON_VALUE is deterministic, so the column is indexable without
 *    PERSISTED (the index materializes it; the row stores nothing). CAST to nvarchar(450) keeps the index
 *    key inside the 1700-byte nonclustered cap — the read side re-checks full equality with a JSON_VALUE
 *    residual, so a >450-char conversation id can never be silently missed (only unindexed).
 *
 * 2. `ix_shipments_created_at` — the Mesh-miss admin worklist filters a rolling window
 *    (`created_at >= @since`) with a residual `critic_review LIKE`; without this index the window itself
 *    was a full scan. The LIKE stays residual by nature (leading wildcard) — bounding the window is the fix.
 *
 * Additive metadata only: no data rewrite (computed column is non-persisted; each index build scans once).
 *
 * OPERATIONAL NOTE: an indexed computed column makes SQL Server require QUOTED_IDENTIFIER ON (and the other
 * ANSI SET options) on any session that WRITES `shipments`. tedious (the app) and SSMS default ON; ad-hoc
 * `sqlcmd` defaults it OFF — pass `-I` for manual INSERT/UPDATE/DELETE against shipments. Reads unaffected.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE shipments ADD conversation_key AS CAST(JSON_VALUE(match_keys, '$.conversation_id') AS nvarchar(450))`,
    )
    .execute(db)
  await sql.raw(`CREATE INDEX ix_shipments_conversation_key ON shipments (conversation_key)`).execute(db)
  await sql.raw(`CREATE INDEX ix_shipments_created_at ON shipments (created_at)`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP INDEX IF EXISTS ix_shipments_created_at ON shipments`).execute(db)
  await sql.raw(`DROP INDEX IF EXISTS ix_shipments_conversation_key ON shipments`).execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS conversation_key`).execute(db)
}
