import { sql, type Kysely } from 'kysely'

/**
 * 0021 — add `vendor_role` to master_resolution kind CHECK.
 * Curated vendor code → role. 'group_shipper' (e.g. SOUOCE — SOUTH OCEAN KNITTERS, the group's export
 * arm on B/L shipper lines) is a HUB relation for cobalt-queue's relatedVendors: hub-vs-any-known-factory
 * merges as a supersede, not a vendor_code conflict — while factory-vs-factory still conflicts (which
 * pairwise vendor_group cannot express without transitively gluing the factories together).
 */
const PREV = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
  'platform_not_forwarder', 'genuine_short_brand', 'self_identity',
  'forwarder_alias',
]
const KINDS = [...PREV, 'vendor_role']

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
