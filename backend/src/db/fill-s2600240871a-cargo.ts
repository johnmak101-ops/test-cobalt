/**
 * One-shot data fix: fill the cargo on shipment S2600240871A (leg bf489ecc-…). The two-factory NEW BOOKING
 * email (慧怡/LEFILG + 天盈/TIKNHO) was never ingested (only RE: replies were), so qty/gross weight/volume
 * came through empty. This enters the TOTALS via the same audited + field-locked edit path a human uses
 * (ShipmentsService.editFields) — so the values are locked (agent can't overwrite) and show in Change
 * History — and records the per-factory split in the note. Idempotent (editFields skips no-op edits).
 *
 * Run: npx tsx src/db/fill-s2600240871a-cargo.ts   (or ts-node --transpile-only)
 */
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@cobalt/contracts'
import { MastersRepository } from './repositories/masters.repository'
import { BookingRepository } from './repositories/booking.repository'
import { ShipmentRepository } from './repositories/shipment.repository'
import { FieldLockRepository } from './repositories/field-lock.repository'
import { AuditRepository } from './repositories/audit.repository'
import { EvidenceRepository } from './repositories/evidence.repository'
import { CommitterService } from '../reconcile/committer.service'
import { ShipmentsService } from '../shipments/shipments.service'

const SHIPMENT_ID = 'bf489ecc-c010-4427-9a32-a9f20da837d9' // S2600240871A
const NOTE =
  'Two-factory NEW BOOKING split (original email/attachment was never ingested): ' +
  '慧怡/LEFILG 126 ctns / 1504 KG / 9.04 CBM (S2600240871A) + 天盈/TIKNHO 160 ctns / 1461.4 KG / 11.5 CBM (S2600240871B). ' +
  'Totals entered here; per-factory figures retained in this note.'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt' })
  const db = drizzle(pool, { schema })

  const shipment = new ShipmentRepository(db)
  const booking = new BookingRepository(db)
  const fieldLock = new FieldLockRepository(db)
  const audit = new AuditRepository(db)
  const committer = new CommitterService(new MastersRepository(db), booking, shipment, fieldLock, audit, new EvidenceRepository(db))
  const svc = new ShipmentsService(shipment, booking, fieldLock, audit, committer)

  const res = await svc.editFields(
    SHIPMENT_ID,
    { qty: 286, qtyUnit: 'cartons', grossWeight: 2965.4, measurement: 20.54 }, // 126+160 / 1504+1461.4 / 9.04+11.5
    null,
    NOTE,
  )
  console.log('edited fields:', JSON.stringify(res))

  const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, SHIPMENT_ID))
  console.log('leg cargo now:', JSON.stringify({ qty: leg?.qty, qtyUnit: leg?.qtyUnit, grossWeight: leg?.grossWeight, measurement: leg?.measurement }))
  const locks = await db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, SHIPMENT_ID))
  console.log('locked fields:', JSON.stringify(locks.map((l) => l.field)))
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
