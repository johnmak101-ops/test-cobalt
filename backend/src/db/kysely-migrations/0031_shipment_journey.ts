import { sql, type Kysely } from 'kysely'

/**
 * 0031 — `shipments.journey` (nvarchar(2000) NULL): the journey CHAIN as JSON.
 *
 * `[{"seq":1,"mode":"Air","pol":"PVG","pod":"DEL","doc":"098-32230085"},…]` — the transit stops of one
 * movement, which the endpoints-only `pol`/`pod` pair cannot hold. Decision 2026-08-03 (option A): the
 * route string shows the chain (`PVG→DEL→LHR` instead of `PVG→LHR`); no other frontend change.
 *
 * Written by the committer from the decision's `journey` — the queue lifts the latest record CARRYING a
 * chain (groupJourney, the `cancelled` pattern for MERGE_EXEMPT fields). Every stop has survived the
 * queue's two validate guards (air legs end at air gateways; every endpoint is VISIBLE in the email
 * that stated it), so what lands here is extraction, never lane-knowledge invention — the audited
 * corpus is 17/17 journeys grounded.
 *
 * Same shape as 0026/0030: additive, nullable, no backfill — historical rows keep NULL until their
 * storyline is re-decided.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD journey nvarchar(2000) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS journey`).execute(db)
}
