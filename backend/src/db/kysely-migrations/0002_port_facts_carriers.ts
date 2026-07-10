import { sql, type Kysely } from 'kysely'

/**
 * 0002 — give ports + carriers their DATA HOME (TODO "code-only rule tables → data").
 *
 * 1. Four new master_resolution kinds carry the port-resolution alias tiers that lived hardcoded in
 *    masters.repository.ts (`ABBREV_OVERRIDE` / `PORT_ALIASES` / `IATA_TO_UNLOCODE` /
 *    `NAME_CONTAINS_ALIASES`): `port_abbreviation`, `port_alias`, `port_iata`, `port_fragment`
 *    (lhs = normalized alias key / fragment, rhs = UN/LOCODE). They inherit the Resolution Rules
 *    ADMIN UI + curator loop + non-destructive seed — same precedent as SEH→customer_group.
 * 2. A `carriers` master (scac UNIQUE + name): ocean carriers have no ERP home (like ports), so the
 *    table is seeded + ops-maintained. This is the data home SCAC extraction (rule 6) needs.
 */
const KINDS = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
]

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  await sql
    .raw(`ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${KINDS.map((k) => `'${k}'`).join(',')}))`)
    .execute(db)
  await sql
    .raw(
      `CREATE TABLE carriers (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  scac nvarchar(10) NOT NULL,
  name nvarchar(500) NOT NULL,
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_carriers PRIMARY KEY (id),
  CONSTRAINT uq_carriers_scac UNIQUE (scac)
)`,
    )
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS carriers`).execute(db)
  await sql.raw(`ALTER TABLE master_resolution DROP CONSTRAINT ck_master_resolution_kind`).execute(db)
  const prev = KINDS.filter((k) => !k.startsWith('port_'))
  await sql
    .raw(`ALTER TABLE master_resolution ADD CONSTRAINT ck_master_resolution_kind CHECK (kind IN (${prev.map((k) => `'${k}'`).join(',')}))`)
    .execute(db)
}
