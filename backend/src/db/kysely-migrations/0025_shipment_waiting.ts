import { sql, type Kysely } from 'kysely'

/**
 * 0025 — `shipments.waiting_at` + `waiting_reason`: the review desk's "parked, I have to go and ask"
 * state.
 *
 * The desk had exactly three outcomes — pending, dismissed, confirmed — so an operator who could not
 * answer a queued question yet (is this thin mail real freight? who is this customer?) had nowhere to
 * put the leg. It either sat in Active forever, growing the pile, or got dismissed as noise when it
 * might have been real. Waiting is the honest third answer: not yes, not no, not today.
 *
 * Deliberately NOT a review_status value: that column's CHECK is ('provisional','confirmed') and it
 * drives alerts/automation, so widening it would leak a UI triage state into the pipeline. Waiting is
 * a stamp on a leg that stays `provisional`, exactly like dismissed_at — same shape, same stickiness,
 * same reversal path (review.restore clears it).
 *
 * No due date and no assignee by design: parking means "not on my desk today", and both of those were
 * cut as complexity the desk has not earned yet. They stay addable later without touching this column.
 *
 * Additive, nullable, no backfill.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE shipments ADD waiting_at datetimeoffset(7) NULL, waiting_reason nvarchar(1000) NULL`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS waiting_at`).execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS waiting_reason`).execute(db)
}
