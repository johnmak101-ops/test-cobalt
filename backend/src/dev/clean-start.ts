/**
 * Clean-start reset for the ShipTrack transactional DB (SQL Server: `cobalt`).
 *
 * Wipes shipment / booking / PO / alert / email-mirror / provenance rows so the pipeline
 * can be re-driven from scratch by the cobalt-queue agent (POST /api/decisions). Master,
 * reference, auth and config data is preserved.
 *
 *   pnpm --filter backend db:clean-start              # DRY: report counts, delete nothing
 *   pnpm --filter backend db:clean-start -- --yes     # DESTRUCTIVE: wipe transactional tables
 *   (or directly)  ts-node -P tsconfig.json src/dev/clean-start.ts [--yes]
 *
 * WIPE (children -> parents; T-SQL has no TRUNCATE ... CASCADE). `routing_shadow` and
 * `critic_calibration` have no FKs (order-independent) and are the two provenance tables the
 * earlier ad-hoc _ops-clean-shipments-tx.ts left behind:
 *   review_email, alerts, shipment_match_keys, shipment_identifiers, shipment_parties,
 *   shipment_emails, shipment_milestones, shipment_pos, field_locks, change_log,
 *   routing_shadow, critic_calibration, shipments, booking_pos, bookings, purchase_orders,
 *   email_read, email_attachment, email_message, parsed_record
 *
 * PRESERVE (never touched):
 *   users, refresh_tokens            - login accounts + sessions (agent@cobalt.hk service acct)
 *   customers, vendors, forwarders,  - Cobalt Mesh-synced master data
 *     forwarder_aliases, consignees
 *   ports, carriers                  - seeded reference data
 *   master_resolution, alert_rules,  - curator rules / alert defs / kv config / Mesh-miss acks
 *     app_settings, mesh_miss_ack
 *
 * The paired queue reset lives in cobalt-queue: src/dev/clean-start.ts. This touches the DB
 * only; shipments are repopulated by re-running the queue matcher (cli match --all).
 */
import { sql, type Kysely } from 'kysely'
import { createKysely } from '../db/kysely/mssql-dialect'

/** children -> parents; also the display order for the WIPE bucket. */
const WIPE = [
  'review_email',
  'alerts',
  'shipment_match_keys',
  'shipment_identifiers',
  'shipment_parties',
  'shipment_emails',
  'shipment_milestones',
  'shipment_pos',
  'field_locks',
  'change_log',
  'routing_shadow',
  'critic_calibration',
  'shipments',
  'booking_pos',
  'bookings',
  'purchase_orders',
  'email_read',
  'email_attachment',
  'email_message',
  'parsed_record',
] as const

const PRESERVE = [
  'users',
  'refresh_tokens',
  'customers',
  'vendors',
  'forwarders',
  'forwarder_aliases',
  'consignees',
  'ports',
  'carriers',
  'master_resolution',
  'alert_rules',
  'app_settings',
  'mesh_miss_ack',
] as const

const SQL_SERVER_URL =
  process.env.SQL_SERVER_URL ??
  'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

/** COUNT(*) per table; -1 means the table is missing / unreadable (tolerated). */
async function counts(db: Kysely<unknown>, tables: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of tables) {
    try {
      const r = await sql.raw(`SELECT COUNT(*) AS c FROM ${t}`).execute(db)
      out[t] = Number((r.rows[0] as { c: number } | undefined)?.c ?? 0)
    } catch {
      out[t] = -1
    }
  }
  return out
}

function printCounts(label: string, wipe: Record<string, number>, preserve: Record<string, number>): void {
  console.log(`\n[${label}]`)
  console.log('  WIPE (transactional):')
  for (const t of WIPE) console.log(`    ${t.padEnd(22)} ${wipe[t]}`)
  console.log('  PRESERVE (masters / users / config):')
  for (const t of PRESERVE) console.log(`    ${t.padEnd(22)} ${preserve[t]}`)
}

async function main(): Promise<void> {
  const yes = process.argv.includes('--yes')
  const db = createKysely<unknown>(SQL_SERVER_URL)

  const beforeWipe = await counts(db, WIPE)
  const beforePreserve = await counts(db, PRESERVE)
  printCounts('cobalt - current', beforeWipe, beforePreserve)

  if (!yes) {
    console.log('\nDRY RUN - pass --yes to wipe the WIPE tables above. Nothing deleted.')
    await db.destroy()
    return
  }

  console.log('\n[wipe] deleting transactional rows (child -> parent)...')
  for (const t of WIPE) {
    try {
      const r = await sql.raw(`DELETE FROM ${t}`).execute(db)
      const n = (r as { numAffectedRows?: bigint | number }).numAffectedRows
      console.log(`  ${t.padEnd(22)} deleted ${n ?? '?'}`)
    } catch (e) {
      console.warn(`  ${t.padEnd(22)} FAIL ${String(e).slice(0, 200)}`)
    }
  }

  const afterWipe = await counts(db, WIPE)
  const afterPreserve = await counts(db, PRESERVE)
  printCounts('cobalt - after wipe', afterWipe, afterPreserve)

  const leftover = WIPE.filter((t) => afterWipe[t]! > 0)
  const preserveChanged = PRESERVE.filter((t) => afterPreserve[t] !== beforePreserve[t])
  if (leftover.length) console.warn(`\n! WIPE tables not empty: ${leftover.join(', ')}`)
  if (preserveChanged.length) console.warn(`! PRESERVE tables changed (should not happen): ${preserveChanged.join(', ')}`)
  if (!leftover.length && !preserveChanged.length) {
    console.log('\nOK - transactional tables empty; masters / users / config preserved.')
  }

  await db.destroy()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
