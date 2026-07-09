/**
 * One-off backfill: enrich EXISTING purchase_orders with per-PO brand / item_style_no / total_quantity(+unit)
 * from parsed evidence. Future commits enrich in the committer (upsertPo); this fills rows that predate that
 * change. Runs the SAME code path (resolvePoEnrichment + BookingRepository.upsertPo fill-if-null) so it is
 * faithful to commit-time behaviour and touches ONLY purchase_orders — no shipment/booking side effects.
 *
 *   npx ts-node --transpile-only -P tsconfig.json src/db/backfill-po-enrichment.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './contracts'
import { EvidenceRepository } from './repositories/evidence.repository'
import { PurchaseOrderRepository } from './repositories/purchase-order.repository'
import { resolvePoEnrichment } from '../reconcile/po-enrichment'
import { normKey } from '../reconcile/match-keys'

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8')
  const m = env.match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error('DATABASE_URL not found in env or .env')
  return m[1].trim()
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl() })
  const db = drizzle(pool, { schema }) as NodePgDatabase<typeof schema>
  const evidence = new EvidenceRepository(db)
  const purchaseOrders = new PurchaseOrderRepository(db)

  const enrichment = resolvePoEnrichment(await evidence.allWithMessage())
  const pos = await db.select().from(schema.purchaseOrders)
  console.log(`POs: ${pos.length} | evidence-derived enrichable POs: ${enrichment.size}`)

  let touched = 0
  for (const po of pos) {
    const enr = enrichment.get(normKey(po.poNumber))
    if (!enr) continue
    // fill-if-null via the production upsertPo (existing PO → only empty enrichment columns are written)
    await purchaseOrders.upsertPo(po.poNumber, po.customerId, po.vendorId, enr)
    touched++
  }
  console.log(`Backfilled (fill-if-null) across ${touched} matched POs.`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
