import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { PurchaseOrderRepository } from '../src/db/repositories/purchase-order.repository'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'
import type { Insertable } from 'kysely'

type ShipmentState = NonNullable<Insertable<DB['shipments']>['state']>

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let repo: PurchaseOrderRepository

beforeAll(async () => {
  db = createKysely<DB>(URL)
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys fk JOIN sys.tables t ON fk.parent_object_id = t.object_id WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'DROP TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';'
FROM sys.tables t WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db).catch(() => {})
  await runMigrations(db, join(process.cwd(), 'src/db/kysely-migrations'))
  repo = new PurchaseOrderRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

async function seedCustomer(code = 'CUST', name = 'Cust') {
  return (await db.insertInto('customers').values({ code, name }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedVendor(code = 'VND', name = 'Vnd') {
  return (await db.insertInto('vendors').values({ code, name }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedBooking(jobNo = 'J1') {
  return (await db.insertInto('bookings').values({ jobNo }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedShipment(bookingId: string, state: ShipmentState = 'BOOKED', legNo = 1) {
  return (await db.insertInto('shipments').values({ bookingId, state, legNo }).output('inserted.id').executeTakeFirstOrThrow()).id
}

describe('PurchaseOrderRepository (SQL Server)', () => {
  it('listPos joins customer/vendor + aggregates shipped qty/count/furthest-status', async () => {
    const cId = await seedCustomer()
    const vId = await seedVendor()
    const bId = await seedBooking('J1')
    const sId = await seedShipment(bId, 'SAILED', 1)
    const sId2 = await seedShipment(bId, 'DELIVERED', 2)
    // upsertPo find-or-create
    const poId = await repo.upsertPo('PO-1', cId, vId, { brand: 'BR', totalQuantity: 100, quantityUnit: 'cartons' })
    // link the PO to two shipments
    await repo.linkShipmentPo(poId, sId, 50, 'cartons')
    await repo.linkShipmentPo(poId, sId2, 50, 'cartons')

    const rows = await repo.listPos()
    const po = rows.find((r) => r.poNumber === 'PO-1')!
    expect(po).toMatchObject({ customerCode: 'CUST', vendorCode: 'VND', brand: 'BR', totalQuantity: 100 })
    expect(po.shippedQuantity).toBe(100) // 50 + 50
    expect(po.shipmentCount).toBe(2)
    expect(po.status).toBe('DELIVERED') // furthest state across the PO's shipments
  })

  it('upsertPo is idempotent + fill-if-null on an existing row (human-wins)', async () => {
    const cId = await seedCustomer('C2', 'C2')
    const poId = await repo.upsertPo('PO-2', cId, null, { brand: 'HUMAN', totalQuantity: 10 })
    // re-upsert with a NEW brand (should NOT overwrite the existing HUMAN) + a new field (itemStyleNo fills null)
    const poIdAgain = await repo.upsertPo('PO-2', cId, null, { brand: 'SHOULD-NOT-APPLY', itemStyleNo: 'STYLE1' })
    expect(poIdAgain).toBe(poId)
    const po = await repo.findPoByNumber('PO-2')
    expect(po?.brand).toBe('HUMAN') // not overwritten
    expect(po?.itemStyleNo).toBe('STYLE1') // filled (was null)
  })

  it('poDetail returns the PO + its linked shipment legs', async () => {
    const cId = await seedCustomer('C3', 'C3')
    const bId = await seedBooking('J3')
    const sId = await seedShipment(bId, 'BOOKED')
    const polId = (await db.insertInto('ports').values({ unlocode: 'CNYTN', name: 'Yantian', country: 'CN', mode: 'sea' }).output('inserted.id').executeTakeFirstOrThrow()).id
    await db.updateTable('shipments').set({ polId, bookingNo: 'B3' }).where('id', '=', sId).execute()
    const poId = await repo.upsertPo('PO-3', cId, null)
    await repo.linkShipmentPo(poId, sId, 5, 'cartons')

    const detail = await repo.poDetail(poId)
    expect(detail).toBeTruthy()
    expect(detail!.po.poNumber).toBe('PO-3')
    expect(detail!.links.length).toBe(1)
    expect(detail!.links[0]).toMatchObject({ bookingNo: 'B3', status: 'BOOKED', polCode: 'CNYTN' })
  })

  it('poById / findPoByNumber / createPo / updatePo / deletePo / poLinkCounts', async () => {
    const po = await repo.createPo({ poNumber: 'PO-4', customerId: null, vendorId: null })
    const poId = po.id
    expect(await repo.poById(poId)).toBeTruthy()
    expect((await repo.findPoByNumber('PO-4'))?.id).toBe(poId)
    await repo.updatePo(poId, { notes: 'a note' })
    expect((await repo.poById(poId))?.notes).toBe('a note')
    expect(await repo.poLinkCounts(poId)).toEqual({ shipments: 0, bookings: 0 })
    await repo.deletePo(poId)
    expect(await repo.poById(poId)).toBeNull()
  })

  it('listPos(openOnly) filters POs whose bookings are all CLOSED/CANCELLED', async () => {
    const bClosed = await seedBooking('JC')
    await db.updateTable('bookings').set({ status: 'CLOSED' }).where('id', '=', bClosed).execute()
    const bOpen = await seedBooking('JO')
    const poClosed = await repo.upsertPo('PO-C', null, null)
    const poOpen = await repo.upsertPo('PO-O', null, null)
    await db.insertInto('bookingPos').values({ bookingId: bClosed, poId: poClosed }).execute()
    await db.insertInto('bookingPos').values({ bookingId: bOpen, poId: poOpen }).execute()

    const open = await repo.listPos(true)
    const numbers = open.map((r) => r.poNumber)
    expect(numbers).toContain('PO-O')
    expect(numbers).not.toContain('PO-C')
  })
})
