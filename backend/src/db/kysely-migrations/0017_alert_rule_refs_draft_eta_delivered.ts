/**
 * POC A1–A6: allow draft_bl + eta as trigger anchors and delivered as a watch target.
 * SQL Server CHECK constraints must be dropped and recreated to widen the allowed set.
 */
import { type Kysely, sql } from 'kysely'

const TRIGGER_REFS =
  "'booking_request','cutoff','departure','warehouse_in','final_bl','etd','draft_bl','eta'"
const WATCH_FOR = "'so','draft_bl','final_bl','telex','sailed','invoice','delivered'"

const OLD_TRIGGER_REFS = "'booking_request','cutoff','departure','warehouse_in','final_bl','etd'"
const OLD_WATCH_FOR = "'so','draft_bl','final_bl','telex','sailed','invoice'"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE alert_rules DROP CONSTRAINT ck_alert_rules_trigger_reference`).execute(db)
  await sql
    .raw(
      `ALTER TABLE alert_rules ADD CONSTRAINT ck_alert_rules_trigger_reference CHECK (trigger_reference IN (${TRIGGER_REFS}))`,
    )
    .execute(db)
  await sql.raw(`ALTER TABLE alert_rules DROP CONSTRAINT ck_alert_rules_watch_for`).execute(db)
  await sql
    .raw(`ALTER TABLE alert_rules ADD CONSTRAINT ck_alert_rules_watch_for CHECK (watch_for IN (${WATCH_FOR}))`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE alert_rules DROP CONSTRAINT ck_alert_rules_trigger_reference`).execute(db)
  await sql
    .raw(
      `ALTER TABLE alert_rules ADD CONSTRAINT ck_alert_rules_trigger_reference CHECK (trigger_reference IN (${OLD_TRIGGER_REFS}))`,
    )
    .execute(db)
  await sql.raw(`ALTER TABLE alert_rules DROP CONSTRAINT ck_alert_rules_watch_for`).execute(db)
  await sql
    .raw(`ALTER TABLE alert_rules ADD CONSTRAINT ck_alert_rules_watch_for CHECK (watch_for IN (${OLD_WATCH_FOR}))`)
    .execute(db)
}
