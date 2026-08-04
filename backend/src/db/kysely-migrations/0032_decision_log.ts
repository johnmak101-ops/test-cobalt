import { sql, type Kysely } from 'kysely'

/** 0032 — append-only log of every decision the committer applied (the ReconGroup, verbatim).
 *
 *  This is the REBUILD source. The legacy rebuild re-derived shipments from raw evidence with its own
 *  grouper + merge twin — both blind to divisions, so a moved PO re-fused the two bookings it had
 *  legitimately crossed (candrholdings#51). Replaying the applied decisions in arrival order through
 *  the committer reproduces the agent path by construction: there is no second brain to drift.
 *
 *  bigint IDENTITY is the replay order — insertion order IS arrival order (the queue posts serially). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE decision_log (
  id bigint IDENTITY(1,1) NOT NULL,
  ingested_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  payload nvarchar(max) NOT NULL,
  CONSTRAINT pk_decision_log PRIMARY KEY (id)
);
CREATE INDEX ix_decision_log_ingested_at ON decision_log(ingested_at);
`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS decision_log`).execute(db)
}
