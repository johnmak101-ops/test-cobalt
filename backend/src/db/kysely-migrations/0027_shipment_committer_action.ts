import { sql, type Kysely } from 'kysely'

/**
 * 0027 — what the COMMITTER actually did with the agent's advice.
 *
 * The review desk has been rendering `critic_review`, which is the queue's deliberation snapshot taken
 * BEFORE the committer acts. Nobody reconciles the two afterwards, so the desk shows questions the
 * pipeline already answered: 41 of 41 checkable conflict rows carried a value the leg already stored,
 * and a picker offering "which shipment does this email update?" sat on legs the committer had just
 * created from that very email.
 *
 * The committer already knew — it stamps `committerChosenLegId` into criticReview on the amend path
 * (#175). Three things were wrong with that: it is written only when a match happens, so CREATED is
 * recorded by ABSENCE; it mutates the agent's payload instead of standing beside it as ShipTrack's own
 * record; and nothing reads it.
 *
 * Absence-as-signal is what made a shipped review-desk rule wrong: it could not tell a leg the email
 * NAMED from a leg the email CREATED, and those are opposite situations that look identical in the
 * data. Every outcome now has a name.
 *
 *   matched               an existing leg absorbed the fields
 *   created               a new leg, and the matcher offered nothing to weigh it against
 *   created_pending_dedup a new leg WHILE candidates existed — "committed, but possibly a duplicate",
 *                         the state that was previously indistinguishable from a settled match
 *   adopted_zero_id       a thread's identity-less leg gained its first strong key
 *   sibling_leg           a new leg under an existing booking (#151)
 *
 * `committer_candidates_considered` records how many the matcher put forward, so a later reader can
 * see the disagreement (the queue proposing N while the committer created anyway) without re-deriving
 * it from the payload.
 *
 * Additive, nullable, no backfill: legs committed before this cannot have their decision recovered,
 * and NULL honestly means "we do not know" rather than guessing a value.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD committer_action nvarchar(40) NULL`).execute(db)
  await sql.raw(`ALTER TABLE shipments ADD committer_target_leg_id uniqueidentifier NULL`).execute(db)
  await sql.raw(`ALTER TABLE shipments ADD committer_candidates_considered int NULL`).execute(db)
  await sql
    .raw(
      `ALTER TABLE shipments ADD CONSTRAINT ck_shipments_committer_action CHECK (
         committer_action IS NULL OR committer_action IN
         ('matched','created','created_pending_dedup','adopted_zero_id','sibling_leg'))`,
    )
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE shipments DROP CONSTRAINT IF EXISTS ck_shipments_committer_action`)
    .execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS committer_action`).execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS committer_target_leg_id`).execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS committer_candidates_considered`).execute(db)
}
