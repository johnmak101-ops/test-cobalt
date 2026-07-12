import { sql, type Kysely } from 'kysely'

/**
 * 0006 — Iterator MOVE 3 party facts as master_resolution kinds (data, not code).
 *
 *  - platform_not_forwarder — lhs = regex/substring for notification portals that must never
 *    link as freight forwarders (overlays SEED in vendor-forwarder-guard).
 *  - genuine_short_brand — lhs = short brand code (FENIX/SKIM/…) consumed by cobalt-queue
 *    party-rules (never flagged as customer-echo).
 *  - self_identity — lhs = regex for our-own company names (queue validate self-identity).
 *
 * Queue already reads these via GET /masters/resolution; this migration only widens the
 * CHECK so ADMIN can create them in Resolution Rules.
 */
const PREV = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
]
const KINDS = [
  ...PREV,
  'platform_not_forwarder',
  'genuine_short_brand',
  'self_identity',
]

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
