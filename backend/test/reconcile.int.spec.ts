import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'
import { ReconcileService } from '../src/reconcile/reconcile.service'
import { SettingsService } from '../src/settings/settings.service'

let db: TestDB
let r: ReturnType<typeof repos>
let reconcile: ReconcileService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  r = repos(db)
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
  const settings = new SettingsService(r.settings, r.routingShadow, r.criticCalibration)
  reconcile = new ReconcileService(r.evidence, committer, settings, r.decisionLog)
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
  const msg = await db
    .insertInto('emailMessage')
    .values({ graphMessageId: graphId, conversationId, receivedAt: new Date(receivedAt), status: 'DONE' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  // graphMessageId is set (the real writer, IngestRepository.upsertFromDecision, always populates it).
  // It also matters here: SQL Server's uq_ingest_parsed_record_gmid_idx treats NULL as a value, so two
  // seeded rows with (NULL, 0) would collide — unlike Postgres, where NULLs are distinct in UNIQUE.
  await db
    .insertInto('parsedRecord')
    .values({
      messageId: msg.id,
      graphMessageId: graphId,
      recordIdx: 0,
      poNo,
      emailType,
      mode: 'Sea-LCL',
      fields: JSON.stringify(fields),
      matchKeys: JSON.stringify(matchKeys),
      confidence: 'high',
    })
    .execute()
}

describe('rebuild = replay (0032)', () => {
  const logged = (over: Partial<ReconGroup> = {}): ReconGroup => ({
    fields: { booking_no: 'BK-OSA', pod: 'Osaka' },
    pos: ['PO-C', 'PO-D'],
    matchKeys: { booking_no: 'BK-OSA' },
    emailTypes: ['Booking Request'],
    events: [{ emailType: 'Booking Request', receivedAt: '2026-06-01T00:00:00Z' }],
    mode: 'Sea-LCL',
    conversationId: 'conv-osa',
    conflicts: [],
    evidenceIds: ['ev-osa'],
    ...over,
  })

  it('🔴 replays the log through the committer — the Day-10 division applies on rebuild too', async () => {
    await r.decisionLog.append(logged() as unknown as Record<string, unknown>)
    await r.decisionLog.append(logged({
      pos: ['PO-C'],
      divisions: [{ pos: ['PO-D'], direction: 'to', target: 'BK-LON', quote: 'PO D 改到伦敦 booking' }],
      events: [{ emailType: 'Booking Request', receivedAt: '2026-06-10T00:00:00Z' }],
    }) as unknown as Record<string, unknown>)

    const res = await reconcile.run()
    expect(res.mode).toBe('replay')
    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(1)
    const pos = await db.selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .where('shipmentPos.shipmentId', '=', legs[0]!.id)
      .select('purchaseOrders.poNumber as poNumber').execute()
    // the replayed division removed PO-D — no re-derive, no second grouper, nothing to drift
    expect(pos.map((p) => p.poNumber)).toEqual(['PO-C'])

    // replaying again lands exactly where it started — the committer's idempotency IS the rebuild's
    const again = await reconcile.run()
    expect(again.mode).toBe('replay')
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1)
  })

  it('🔴 the fuse: pre-log evidence carrying a division REFUSES the legacy re-derive', async () => {
    // no decision_log rows, and the raw evidence says cargo moved bookings — the one shape the
    // legacy union-by-PO grouper is guaranteed to rebuild wrong. Loud refusal beats silent fusion.
    await seedEmail('d1', '2026-06-10T00:00:00Z', 'Booking Request',
      { booking_no: 'BK-1', division: { pos: ['PO-9'], direction: 'to', target: 'BK-2', quote: 'PO 9 moved' } },
      { booking_no: 'BK-1', customer_po: 'PO-9' }, 'PO-9')
    await expect(reconcile.run()).rejects.toThrow(/division/)
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(0)
  })
})

describe('ReconcileService (integration)', () => {
  it('threads a chain (rotating IDs, shared PO) into ONE booking with the right state', async () => {
    await seedEmail('m1', '2026-01-01T00:00:00Z', 'Booking Request', { booking_no: 'BK-1' }, { booking_no: 'BK-1', customer_po: 'PO-X' }, 'PO-X')
    await seedEmail('m2', '2026-01-03T00:00:00Z', 'SO', { so_no: 'SO-1' }, { so_no: 'SO-1', customer_po: 'PO-X' }, 'PO-X')
    await seedEmail('m3', '2026-01-05T00:00:00Z', 'Draft B/L', { hbl_awb_fcr_no: 'HBL-1' }, { hbl_awb_fcr_no: 'HBL-1', customer_po: 'PO-X' }, 'PO-X')

    const res = await reconcile.run()
    expect(res.evidence).toBe(3)
    expect(res.groups).toBe(1) // PO threads them despite booking#->SO#->HBL# rotation

    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(1)
    expect(legs[0]!.state).toBe('AT_WAREHOUSE') // Draft B/L reached
    expect(legs[0]!.soNo).toBe('SO-1')
    expect(legs[0]!.hblAwbFcrNo).toBe('HBL-1')
  })

  it('keeps two unrelated PO threads as two bookings', async () => {
    await seedEmail('a1', '2026-01-01T00:00:00Z', 'SO', { so_no: 'SO-A' }, { so_no: 'SO-A', customer_po: 'PO-A' }, 'PO-A', 'thread-A')
    await seedEmail('b1', '2026-01-01T00:00:00Z', 'SO', { so_no: 'SO-B' }, { so_no: 'SO-B', customer_po: 'PO-B' }, 'PO-B', 'thread-B')
    const res = await reconcile.run()
    expect(res.groups).toBe(2)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(2)
  })
})
