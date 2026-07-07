/**
 * Corrective recompute for the shipment-total broadcast bug: purchase_orders.total_quantity was
 * enriched from per-PO parsed records, but a 收仓数据-style email states ONE shipment total (168)
 * on every per-PO record — 20 POs all got total_quantity=168. resolvePoEnrichment now carries a
 * broadcast guard; this script recomputes and OVERWRITES total_quantity/quantity_unit with the
 * fixed result (including back to NULL). Safe because these columns were all-NULL before the
 * enrichment feature — every existing value is enrichment-derived, never human/ERP-set.
 *
 *   DATABASE_URL=... npx tsx src/db/fix-po-total-broadcast.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from './contracts'
import { EvidenceRepository } from './repositories/evidence.repository'
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

  const enrichment = resolvePoEnrichment(await evidence.allWithMessage())
  const pos = await db.select().from(schema.purchaseOrders)

  let cleared = 0
  let changed = 0
  for (const po of pos) {
    const enr = enrichment.get(normKey(po.poNumber))
    const nextQty = enr?.totalQuantity ?? null
    const nextUnit = nextQty != null ? (enr?.quantityUnit ?? null) : null
    if (po.totalQuantity === nextQty && (po.quantityUnit ?? null) === nextUnit) continue
    await db
      .update(schema.purchaseOrders)
      .set({ totalQuantity: nextQty, quantityUnit: nextUnit, updatedAt: new Date() })
      .where(eq(schema.purchaseOrders.id, po.id))
    if (nextQty == null) cleared++
    else changed++
    console.log(`${po.poNumber}: ${po.totalQuantity ?? '∅'} ${po.quantityUnit ?? ''} -> ${nextQty ?? '∅'} ${nextUnit ?? ''}`)
  }
  console.log(`\nrecompute done: ${cleared} cleared to NULL, ${changed} changed to a real per-PO value, ${pos.length} scanned`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
