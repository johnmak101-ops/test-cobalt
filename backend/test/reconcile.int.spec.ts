import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '@cobalt/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService } from '../src/reconcile/committer.service'
import { ReconcileService } from '../src/reconcile/reconcile.service'

let db: TestDB
let reconcile: ReconcileService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit)
  reconcile = new ReconcileService(r.evidence, committer)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seedEmail(
  graphId: string,
  receivedAt: string,
  emailType: string,
  fields: Record<string, unknown>,
  matchKeys: Record<string, unknown>,
  poNo: string,
  conversationId = 'thread-1',
) {
  const [msg] = await db
    .insert(schema.queueMessage)
    .values({ graphMessageId: graphId, conversationId, receivedAt: new Date(receivedAt), status: 'DONE' })
    .returning()
  await db
    .insert(schema.parsedRecord)
    .values({ messageId: msg.id, recordIdx: 0, poNo, emailType, mode: 'Sea-LCL', fields, matchKeys, confidence: 'high' })
}

describe('ReconcileService (integration)', () => {
  it('threads a chain (rotating IDs, shared PO) into ONE booking with the right state', async () => {
    await seedEmail('m1', '2026-01-01T00:00:00Z', 'Booking Request', { booking_no: 'BK-1' }, { booking_no: 'BK-1', customer_po: 'PO-X' }, 'PO-X')
    await seedEmail('m2', '2026-01-03T00:00:00Z', 'SO', { so_no: 'SO-1' }, { so_no: 'SO-1', customer_po: 'PO-X' }, 'PO-X')
    await seedEmail('m3', '2026-01-05T00:00:00Z', 'Draft B/L', { hbl_awb_fcr_no: 'HBL-1' }, { hbl_awb_fcr_no: 'HBL-1', customer_po: 'PO-X' }, 'PO-X')

    const res = await reconcile.run()
    expect(res.evidence).toBe(3)
    expect(res.groups).toBe(1) // PO threads them despite booking#->SO#->HBL# rotation

    expect(await db.select().from(schema.bookings)).toHaveLength(1)
    const legs = await db.select().from(schema.shipments)
    expect(legs).toHaveLength(1)
    expect(legs[0].state).toBe('AT_WAREHOUSE') // Draft B/L reached
    expect(legs[0].soNo).toBe('SO-1')
    expect(legs[0].hblAwbFcrNo).toBe('HBL-1')
  })

  it('keeps two unrelated PO threads as two bookings', async () => {
    await seedEmail('a1', '2026-01-01T00:00:00Z', 'SO', { so_no: 'SO-A' }, { so_no: 'SO-A', customer_po: 'PO-A' }, 'PO-A', 'thread-A')
    await seedEmail('b1', '2026-01-01T00:00:00Z', 'SO', { so_no: 'SO-B' }, { so_no: 'SO-B', customer_po: 'PO-B' }, 'PO-B', 'thread-B')
    const res = await reconcile.run()
    expect(res.groups).toBe(2)
    expect(await db.select().from(schema.bookings)).toHaveLength(2)
  })
})
