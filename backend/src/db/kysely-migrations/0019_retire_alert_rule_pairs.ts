/**
 * Collapse the warn/critical pairs to single-severity rules: A1 (draft) and A3 (final) carry the
 * one threshold + user-chosen severity; the critical tiers A2/A4 are retired — disabled + locked,
 * their open alerts resolved. Rows are kept (alerts.rule_id FK + history), never deleted.
 */
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // SNOOZED as well as ACTIVE: retirement is permanent, a snoozed alert of a dead rule must not
  // resurface. dedup_key is rewritten (UNIQUE) exactly like AlertRepository.resolveAllActiveForRule
  // so a future re-fire could still insert.
  //
  // `id` MUST be CONVERTed before it meets dedup_key: uniqueidentifier outranks nvarchar in SQL
  // Server's data-type precedence, so a bare COALESCE(dedup_key, id) coerces the *string* to a GUID
  // and dies with "Conversion failed … to uniqueidentifier" (Msg 8169) on every matching row.
  await sql
    .raw(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = SYSUTCDATETIME(), dedup_key = CONCAT(COALESCE(dedup_key, CONVERT(nvarchar(36), id)), ':resolved:', CONVERT(nvarchar(36), id)) WHERE rule_id IN ('A2','A4') AND status IN ('ACTIVE','SNOOZED')`,
    )
    .execute(db)
  await sql
    .raw(`UPDATE alert_rules SET enabled = 0, locked = 1, updated_at = SYSUTCDATETIME() WHERE id IN ('A2','A4')`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`UPDATE alert_rules SET enabled = 1, locked = 0, updated_at = SYSUTCDATETIME() WHERE id IN ('A2','A4')`)
    .execute(db)
}
