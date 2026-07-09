import { sql, type Kysely } from 'kysely'

/**
 * 0001 — add 'prior_correction' to the master_resolution kind CHECK.
 *
 * LLM Master Matcher (design 2026-07-09 + T-SQL re-spec 2026-07-10): a human correction is stored as a
 * `prior_correction` fact (lhs = raw name|domain, rhs = master code) and read by the candidates
 * retrieval endpoint as a top-rank BOOST signal — the LLM still decides every time (decision D:
 * no deterministic fast-path). These rows are excluded from the consumer `GET /masters/resolution`
 * payload; they are a retrieval signal, not a resolution rule.
 */
const KINDS = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
]

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  await sql
    .raw(`ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(',')}))`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  await sql
    .raw(
      `ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${KINDS.filter((k) => k !== 'prior_correction').map((k) => `'${k}'`).join(',')}))`,
    )
    .execute(db)
}
