import { sql, type Kysely } from 'kysely'

/**
 * 0015 — add `forwarder_alias` to master_resolution kind CHECK (#145).
 * Curated exact: raw forwarder name → forwarder master code (committer pre-lookup).
 */
const PREV = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
  'platform_not_forwarder', 'genuine_short_brand', 'self_identity',
]
const KINDS = [...PREV, 'forwarder_alias']

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  await sql
    .raw(
      `ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(',')}))`,
    )
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  await sql
    .raw(
      `ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${PREV.map((k) => `'${k}'`).join(',')}))`,
    )
    .execute(db)
}
