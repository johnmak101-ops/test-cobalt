import { sql, type Kysely } from 'kysely'

/** 0013 — append-only shadow log of gate vs band routing at decision ingest (Phase 2a). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE routing_shadow (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  shipment_id uniqueidentifier NULL,
  ingested_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  gate_routing nvarchar(20) NOT NULL,
  band_routing nvarchar(20) NOT NULL,
  band nvarchar(10) NULL,
  differs bit NOT NULL,
  reasons_json nvarchar(max) NULL,
  CONSTRAINT pk_routing_shadow PRIMARY KEY (id),
  CONSTRAINT ck_routing_shadow_gate CHECK (gate_routing IN ('confirmed','provisional','skip')),
  CONSTRAINT ck_routing_shadow_band CHECK (band_routing IN ('confirmed','provisional','skip'))
);
CREATE INDEX ix_routing_shadow_ingested_at ON routing_shadow(ingested_at);
CREATE INDEX ix_routing_shadow_differs ON routing_shadow(differs);
CREATE INDEX ix_routing_shadow_shipment_id ON routing_shadow(shipment_id);
`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS routing_shadow`).execute(db)
}
