/**
 * One-shot backfill: re-run kind classification on existing SHIPMENT legs and demote the ones that are
 * built ENTIRELY from CVP/TradeLinkOne notification-platform emails with no lifecycle email and no real
 * carrier identity — a vendor/PO notification (e.g. a "Vendor Delivery Date – Past due" alert) whose only
 * "identity" is the portal's own LPO leaked into booking_no. This is the pre-existing counterpart to the
 * committer's new classifyKind rule (c); it only DOWNGRADES SHIPMENT→DOCUMENT (never the reverse) and
 * writes an audit.change_log row per flip. Idempotent — re-running finds nothing.
 *
 * Reuses the real classifyKind so the backfill can never drift from the committer.
 *
 * Preview:  npx tsx src/db/reclassify-platform-documents.ts
 * Apply:    APPLY=1 npx tsx src/db/reclassify-platform-documents.ts
 */
import { Pool } from 'pg'
import { classifyKind } from '../reconcile/state'
import { isNotificationPlatformSender } from '../reconcile/vendor-forwarder-guard'

const IDENTITY = ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt',
  })
  const apply = process.env.APPLY === '1'

  const legs = (
    await pool.query(
      `SELECT id, booking_no, so_no, hbl_awb_fcr_no, mbl, container_no
         FROM tracking.shipments WHERE kind = 'SHIPMENT'`,
    )
  ).rows as Record<string, string | null>[]

  // Only demote legs whose classification changes BECAUSE of the new platform signal — old(no platform)
  // says SHIPMENT, new(with platform) says DOCUMENT. That isolates rule (c)'s effect and leaves any
  // pre-existing rule (a)/(b) discrepancies (already-DOCUMENT-by-logic but stored SHIPMENT) untouched.
  const flips: { id: string; booking_no: string | null; types: string[] }[] = []
  let preExisting = 0
  for (const leg of legs) {
    // every source email of this leg: its raw type + the sender that produced it
    const emails = (
      await pool.query(
        `SELECT se.email_type, qm.sender
           FROM tracking.shipment_emails se
           LEFT JOIN ingest.email_message qm ON qm.graph_message_id = se.graph_message_id
          WHERE se.shipment_id = $1`,
        [leg.id],
      )
    ).rows as { email_type: string | null; sender: string | null }[]
    if (!emails.length) continue

    const emailTypes = new Set(emails.map((e) => e.email_type).filter((t): t is string => !!t))
    const fromPlatform = emails.every((e) => isNotificationPlatformSender(e.sender))
    const fields = Object.fromEntries(IDENTITY.map((k) => [k, leg[k]]))
    const before = classifyKind(emailTypes, fields, {})
    const after = classifyKind(emailTypes, fields, { fromPlatform })
    if (after !== 'DOCUMENT') continue
    if (before === 'DOCUMENT') { preExisting++; continue } // already a document by the old rules — out of scope
    flips.push({ id: String(leg.id), booking_no: leg.booking_no, types: [...emailTypes] })
  }

  console.log(`SHIPMENT legs scanned: ${legs.length}`)
  console.log(`legs demoted by the NEW platform rule (c): ${flips.length}`)
  console.log(`legs already DOCUMENT-by-old-rules but stored SHIPMENT (pre-existing, NOT touched): ${preExisting}`)
  for (const f of flips) console.log(`  ${f.id}  booking_no=${f.booking_no ?? '—'}  types=[${f.types.join(', ')}]`)

  if (!apply) {
    console.log('\n(preview only — re-run with APPLY=1 to write)')
    await pool.end()
    return
  }
  for (const f of flips) {
    await pool.query(`UPDATE tracking.shipments SET kind = 'DOCUMENT', updated_at = now() WHERE id = $1`, [f.id])
    await pool.query(
      `INSERT INTO audit.change_log (entity_type, entity_id, field, old_value, new_value, change_type, source_type, note)
       VALUES ('shipment', $1, 'kind', 'SHIPMENT', 'DOCUMENT', 'update', 'system',
               'CVP notification-platform-only leg (no lifecycle email, no carrier id) — moved to Documents (backfill)')`,
      [f.id],
    )
  }
  console.log(`\napplied: ${flips.length} legs demoted to DOCUMENT`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
