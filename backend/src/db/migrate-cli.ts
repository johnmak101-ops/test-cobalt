/**
 * Migration runner for dev boot / Docker entrypoint / prod deploy:
 *   1. creates the target database if it doesn't exist (connects to master first), then
 *   2. applies every unapplied migration from the STATIC registry below (Kysely Migrator +
 *      its `kysely_migration` ledger — idempotent, incremental).
 *
 * Run: `pnpm --filter backend run db:migrate` (ts-node) or `node dist/db/migrate-cli.js` (compiled).
 *
 * The registry is static (not a folder scan) on purpose: the FileMigrationProvider in
 * `kysely/migrate.ts` needs native dynamic `import()`, which works under vitest (ESM) but breaks
 * under ts-node/tsc CommonJS output. New migration = new module in ./kysely-migrations + one line here.
 */
import { Migrator } from 'kysely/migration'
import { createKysely, parseMssqlConnectionString } from './kysely/mssql-dialect'
import { sql } from 'kysely'
import type { DB } from './kysely/db'
import * as m0000_init from './kysely-migrations/0000_init'
import * as m0001_prior_correction_kind from './kysely-migrations/0001_prior_correction_kind'
import * as m0002_port_facts_carriers from './kysely-migrations/0002_port_facts_carriers'
import * as m0003_shipment_match_keys from './kysely-migrations/0003_shipment_match_keys'
import * as m0004_purchase_order_norm from './kysely-migrations/0004_purchase_order_norm'
import * as m0005_parsed_record_po_norm from './kysely-migrations/0005_parsed_record_po_norm'
import * as m0006_party_resolution_kinds from './kysely-migrations/0006_party_resolution_kinds'
import * as m0007_parsed_record_prompt_version from './kysely-migrations/0007_parsed_record_prompt_version'
import * as m0008_shipment_customer_raw from './kysely-migrations/0008_shipment_customer_raw'
import * as m0009_milestone_type_sailed from './kysely-migrations/0009_milestone_type_sailed'
import * as m0010_shipment_vendor_raw from './kysely-migrations/0010_shipment_vendor_raw'
import * as m0011_shipment_list_fields_widen from './kysely-migrations/0011_shipment_list_fields_widen'
import * as m0012_shipment_critic_review from './kysely-migrations/0012_shipment_critic_review'
import * as m0013_routing_shadow from './kysely-migrations/0013_routing_shadow'
import * as m0014_critic_calibration from './kysely-migrations/0014_critic_calibration'
import * as m0015_forwarder_alias_kind from './kysely-migrations/0015_forwarder_alias_kind'
import * as m0016_mesh_miss_ack from './kysely-migrations/0016_mesh_miss_ack'

const MIGRATIONS = {
  '0000_init': m0000_init,
  '0001_prior_correction_kind': m0001_prior_correction_kind,
  '0002_port_facts_carriers': m0002_port_facts_carriers,
  '0003_shipment_match_keys': m0003_shipment_match_keys,
  '0004_purchase_order_norm': m0004_purchase_order_norm,
  '0005_parsed_record_po_norm': m0005_parsed_record_po_norm,
  '0006_party_resolution_kinds': m0006_party_resolution_kinds,
  '0007_parsed_record_prompt_version': m0007_parsed_record_prompt_version,
  '0008_shipment_customer_raw': m0008_shipment_customer_raw,
  '0009_milestone_type_sailed': m0009_milestone_type_sailed,
  '0010_shipment_vendor_raw': m0010_shipment_vendor_raw,
  '0011_shipment_list_fields_widen': m0011_shipment_list_fields_widen,
  '0012_shipment_critic_review': m0012_shipment_critic_review,
  '0013_routing_shadow': m0013_routing_shadow,
  '0014_critic_calibration': m0014_critic_calibration,
  '0015_forwarder_alias_kind': m0015_forwarder_alias_kind,
  '0016_mesh_miss_ack': m0016_mesh_miss_ack,
}

/** Exported for the registry drift-guard spec — a migration file that is never registered here is
 *  SILENTLY skipped at deploy (no error, no log), so the guard fails a test instead. */
export const REGISTERED_MIGRATIONS = Object.keys(MIGRATIONS)

const URL =
  process.env.SQL_SERVER_URL ??
  'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

async function main() {
  const cfg = parseMssqlConnectionString(URL)
  const dbName = cfg.database
  if (cfg.isEntra) {
    // Fabric SQL: the database is pre-provisioned and `master` isn't exposed — skip CREATE DATABASE.
    console.log(`[migrate] Entra/Fabric mode — assuming ${dbName} is pre-provisioned (skipping CREATE DATABASE)`)
  } else {
    const master = createKysely<unknown>(URL.replace(/Database=[^;]+/i, 'Database=master'))
    await sql.raw(`IF DB_ID('${dbName}') IS NULL CREATE DATABASE [${dbName}]`).execute(master)
    await master.destroy()
  }

  const db = createKysely<DB>(URL)
  const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } })
  const { error, results } = await migrator.migrateToLatest()
  for (const r of results ?? []) console.log(`[migrate] ${r.migrationName}: ${r.status}`)
  await db.destroy()
  if (error) throw error
  console.log(`[migrate] ${dbName} is up to date (${(results ?? []).length} applied this run)`)
}

main().catch((e) => {
  // Print the whole error (tedious connection failures are often an AggregateError whose top-level
  // message is empty — the real reasons live in `.errors[]`/`.cause`), so failures are diagnosable.
  console.error('[migrate] failed:', e)
  if (e && typeof e === 'object') {
    const anyE = e as { cause?: unknown; errors?: unknown }
    if (anyE.cause) console.error('[migrate] cause:', anyE.cause)
    if (Array.isArray(anyE.errors)) anyE.errors.forEach((sub, i) => console.error(`[migrate] sub-error[${i}]:`, sub))
  }
  process.exit(1)
})
