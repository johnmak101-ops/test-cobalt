import { sql, type Kysely } from 'kysely'

/** 0014 — append-only critic band vs human outcome (Phase 3 calibration). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE critic_calibration (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  shipment_id uniqueidentifier NULL,
  decided_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  band nvarchar(10) NULL,
  outcome nvarchar(20) NOT NULL,
  corrected_field_count int NOT NULL DEFAULT 0,
  actor_id uniqueidentifier NULL,
  reasons_json nvarchar(max) NULL,
  CONSTRAINT pk_critic_calibration PRIMARY KEY (id),
  CONSTRAINT ck_critic_calibration_outcome CHECK (outcome IN ('approved','corrected','dismissed'))
);
CREATE INDEX ix_critic_calibration_decided_at ON critic_calibration(decided_at);
CREATE INDEX ix_critic_calibration_band ON critic_calibration(band);
CREATE INDEX ix_critic_calibration_outcome ON critic_calibration(outcome);
CREATE INDEX ix_critic_calibration_shipment_id ON critic_calibration(shipment_id);
`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS critic_calibration`).execute(db)
}
