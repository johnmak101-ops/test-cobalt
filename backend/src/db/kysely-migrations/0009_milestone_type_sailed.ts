import { sql, type Kysely } from 'kysely'

/**
 * 0009 — add 'SAILED' to the shipment_milestones.milestone_type CHECK.
 *
 * deriveMilestoneRows has always emitted a 'SAILED' milestone (atd → SAILED, plus the etd-fallback when a
 * leg reaches SAILED state with no atd), and the UI reads milestoneMap.get('SAILED') to date its Departure
 * step — but 'SAILED' was never in ck_shipment_milestones_type. So for EVERY sailed shipment the milestone
 * INSERT threw the CHECK violation, which aborted MilestoneSynchronizer.sync BEFORE it wrote shipment_emails
 * → blank milestone timeline AND "no related emails". Recreate the constraint with 'SAILED' included.
 */
const TYPES = "'BOOKING_SENT','SO_RECEIVED','AT_WAREHOUSE','DRAFT_BL_RECEIVED','FINAL_BL_RECEIVED','SAILED','TELEX_RELEASED','INVOICE_RECEIVED','DELIVERED'"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipment_milestones DROP CONSTRAINT ck_shipment_milestones_type`).execute(db)
  await sql
    .raw(`ALTER TABLE shipment_milestones ADD CONSTRAINT ck_shipment_milestones_type CHECK (milestone_type IN (${TYPES}))`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const OLD = "'BOOKING_SENT','SO_RECEIVED','AT_WAREHOUSE','DRAFT_BL_RECEIVED','FINAL_BL_RECEIVED','TELEX_RELEASED','INVOICE_RECEIVED','DELIVERED'"
  await sql.raw(`ALTER TABLE shipment_milestones DROP CONSTRAINT ck_shipment_milestones_type`).execute(db)
  await sql
    .raw(`ALTER TABLE shipment_milestones ADD CONSTRAINT ck_shipment_milestones_type CHECK (milestone_type IN (${OLD}))`)
    .execute(db)
}
