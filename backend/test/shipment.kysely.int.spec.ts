import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { ShipmentRepository } from '../src/db/repositories/shipment.repository'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let repo: ShipmentRepository

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
  repo = new ShipmentRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

let mark = 0
async function seedBooking(opts: { customerId?: string | null; forwarderId?: string | null } = {}) {
  mark += 1
  return (await db.insertInto('bookings').values({
    jobNo: `J-${mark}-${Math.random()}`, customerId: opts.customerId ?? null, forwarderId: opts.forwarderId ?? null,
  }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedLeg(opts: {
  bookingId: string
  state?: string
  legStatus?: string
  reviewStatus?: string
  kind?: string
  confidence?: number | null
  linkedShipmentId?: string | null
  dismissedAt?: Date | null
  mode?: string | null
  forwarderId?: string | null
  polId?: string | null
  podId?: string | null
  legNo?: number
  qty?: number | null
  qtyUnit?: string | null
}) {
  const row = await db.insertInto('shipments').values({
    bookingId: opts.bookingId, state: opts.state ?? 'BOOKED', legStatus: opts.legStatus ?? 'ACTIVE',
    reviewStatus: opts.reviewStatus ?? 'confirmed', kind: opts.kind ?? 'SHIPMENT',
    confidence: opts.confidence ?? null, linkedShipmentId: opts.linkedShipmentId ?? null,
    dismissedAt: opts.dismissedAt ?? null, mode: opts.mode ?? null,
    forwarderId: opts.forwarderId ?? null, polId: opts.polId ?? null, podId: opts.podId ?? null,
    legNo: opts.legNo ?? mark,
    qty: opts.qty ?? null, qtyUnit: opts.qtyUnit ?? null,
  }).outputAll('inserted').executeTakeFirstOrThrow()
  return row
}
async function seedCustomer(code = `C${mark}`) {
  return (await db.insertInto('customers').values({ code, name: `Cust ${code}` }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedForwarder(code = `F${mark}`) {
  return (await db.insertInto('forwarders').values({ code, name: `Fwd ${code}` }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedPort(unlocode = `CNYTN${mark}`, mode = 'sea') {
  return (await db.insertInto('ports').values({ unlocode, name: unlocode, country: 'CN', mode }).output('inserted.id').executeTakeFirstOrThrow()).id
}
async function seedPo(poNumber = `PO-${mark}-${Math.random()}`) {
  const id = (await db.insertInto('purchaseOrders').values({ poNumber }).output('inserted.id').executeTakeFirstOrThrow()).id
  return { id, poNumber }
}

describe('ShipmentRepository (SQL Server)', () => {
  it('allLegs / activeLegs / activeConfirmedLegs / provisionalLegs filter correctly', async () => {
    const b = await seedBooking()
    await seedLeg({ bookingId: b, legNo: 11, legStatus: 'ACTIVE', reviewStatus: 'confirmed' })
    await seedLeg({ bookingId: b, legNo: 12, legStatus: 'CANCELLED', reviewStatus: 'confirmed' })
    await seedLeg({ bookingId: b, legNo: 13, legStatus: 'SUPERSEDED', reviewStatus: 'confirmed' })
    await seedLeg({ bookingId: b, legNo: 14, legStatus: 'ACTIVE', reviewStatus: 'provisional', confidence: 30 })
    await seedLeg({ bookingId: b, legNo: 15, legStatus: 'ACTIVE', reviewStatus: 'provisional', confidence: 10 })
    const dismissed = await seedLeg({
      bookingId: b, legNo: 16, legStatus: 'ACTIVE', reviewStatus: 'provisional', dismissedAt: new Date(),
    })

    const active = await repo.activeLegs()
    expect(active.filter((l) => l.legStatus === 'SUPERSEDED').length).toBe(0) // superseded hidden
    expect(active.filter((l) => l.legStatus === 'CANCELLED').length).toBeGreaterThanOrEqual(1) // cancelled surfaces
    expect(active.find((l) => l.id === dismissed.id)).toBeUndefined() // dismissed husks leave tracker/dashboard
    const confirmed = await repo.activeConfirmedLegs()
    expect(confirmed.every((l) => l.legStatus === 'ACTIVE' && l.reviewStatus === 'confirmed')).toBe(true)
    const prov = await repo.provisionalLegs()
    expect(prov.length).toBeGreaterThanOrEqual(2)
    expect(prov[0].confidence).toBeLessThanOrEqual(prov[1].confidence) // lowest confidence first
  })

  it('reviewQueue views + reviewQueueCounts (pending vs dismissed vs approved)', async () => {
    const b = await seedBooking()
    const c = await seedCustomer(`RQ${mark}`)
    await db.updateTable('bookings').set({ customerId: c }).where('id', '=', b).execute()
    const polId = await seedPort(`HKHKG${mark}`)
    const leg = await seedLeg({ bookingId: b, legNo: 21, reviewStatus: 'provisional', kind: 'SHIPMENT', confidence: 25, polId })
    await db.updateTable('shipments').set({ legStatus: 'ACTIVE' }).where('id', '=', leg.id).execute()
    await seedLeg({ bookingId: b, legNo: 22, reviewStatus: 'provisional', kind: 'DOCUMENT' }) // document excluded
    const confirmedBare = await seedLeg({ bookingId: b, legNo: 23, reviewStatus: 'confirmed', kind: 'SHIPMENT' }) // confirmed without critic — not in approved
    const gone = await seedLeg({ bookingId: b, legNo: 24, reviewStatus: 'provisional', kind: 'SHIPMENT', dismissedAt: new Date() })
    const confirmedCritic = await seedLeg({
      bookingId: b,
      legNo: 25,
      reviewStatus: 'confirmed',
      kind: 'SHIPMENT',
      confidence: 40,
    })
    await db
      .updateTable('shipments')
      .set({
        legStatus: 'ACTIVE',
        reviewedAt: new Date('2026-07-14T10:00:00.000Z'),
        criticReview: JSON.stringify({
          confidence: { score: 0.4, band: 'medium', label: 'Medium' },
          summary: 'ok',
          observations: [],
          priorState: { headline: '', fields: [] },
          proposedChanges: [],
          riskFlags: [],
          reasons: [],
          recommendedHumanAction: 'none',
        }),
      } as never)
      .where('id', '=', confirmedCritic.id)
      .execute()

    const q = await repo.reviewQueue()
    const found = q.find((r) => r.id === leg.id)
    expect(found).toBeTruthy()
    expect(found?.customerCode).toBe(`RQ${mark}`)
    expect(found?.polCode).toBe(`HKHKG${mark}`)
    expect(q.find((r) => r.id === gone.id)).toBeUndefined() // dismissed rows leave the pending queue

    const d = await repo.reviewQueue('dismissed')
    expect(d.find((r) => r.id === gone.id)).toBeTruthy()
    expect(d.find((r) => r.id === leg.id)).toBeUndefined()

    const a = await repo.reviewQueue('approved')
    expect(a.find((r) => r.id === confirmedCritic.id)).toBeTruthy()
    expect(a.find((r) => r.id === confirmedBare.id)).toBeUndefined() // no criticReview → excluded
    expect(a.find((r) => r.id === leg.id)).toBeUndefined() // still provisional

    const counts = await repo.reviewQueueCounts()
    expect(counts.pending).toBeGreaterThanOrEqual(1)
    expect(counts.dismissed).toBeGreaterThanOrEqual(1)

    // provisionalLegs (the /api/review list) must also skip dismissed rows
    const prov = await repo.provisionalLegs()
    expect(prov.find((r) => r.id === gone.id)).toBeUndefined()
  })

  it('legsForBooking orders by legNo; findById / findByIds (batch, empty→no query)', async () => {
    const b = await seedBooking()
    const l1 = await seedLeg({ bookingId: b, legNo: 2 })
    const l2 = await seedLeg({ bookingId: b, legNo: 1 })
    const legs = await repo.legsForBooking(b)
    expect(legs.map((l) => l.legNo)).toEqual([1, 2])
    expect(await repo.findById(l1.id)).toBeTruthy()
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull()
    const byId = await repo.findByIds([l1.id, l2.id])
    expect(byId.size).toBe(2)
    expect((await repo.findByIds([])).size).toBe(0)
  })

  it('insertLeg (stringifies matchKeys) + updateLeg + legDetailById + linkedPosForBooking', async () => {
    const b = await seedBooking()
    const c = await seedCustomer(`DT${mark}`)
    const f = await seedForwarder(`DTF${mark}`)
    const pol = await seedPort(`CNSHA${mark}`)
    const pod = await seedPort(`USLAX${mark}`)
    await db.updateTable('bookings').set({ customerId: c, forwarderId: f }).where('id', '=', b).execute()
    const criticReview = {
      confidence: { score: 38, band: 'low' as const, label: 'Low' },
      summary: 'Two HBLs',
      observations: [] as string[],
      priorState: { headline: 'New', fields: [] as unknown[] },
      proposedChanges: [] as unknown[],
      riskFlags: [] as { code: string; severity: 'low' | 'medium' | 'high'; message: string }[],
      recommendedHumanAction: 'split_or_multi_leg',
      reasons: ['multi'],
    }
    const leg = await repo.insertLeg({
      bookingId: b, state: 'BOOKED', mode: 'SEA', forwarderId: f, polId: pol, podId: pod,
      matchKeys: { booking_no: 'B1' },
      criticReview,
    })
    // matchKeys / criticReview stored as JSON nvarchar(max); ParseJSONResultsPlugin parses back on read
    const persisted = await db.selectFrom('shipments').where('id', '=', leg.id).select(['matchKeys', 'criticReview']).executeTakeFirst()
    expect(persisted?.matchKeys).toEqual({ booking_no: 'B1' })
    expect(persisted?.criticReview).toMatchObject({ confidence: { band: 'low' }, summary: 'Two HBLs' })

    await repo.updateLeg(leg.id, { state: 'SAILED', bookingNo: 'B-NEW' })
    const detail = await repo.legDetailById(leg.id)
    expect(detail?.state).toBe('SAILED')
    expect(detail?.bookingNo).toBe('B-NEW')
    expect(detail?.customerCode).toBe(`DT${mark}`)
    expect(detail?.polCode).toBe(`CNSHA${mark}`)
    expect(detail?.podCode).toBe(`USLAX${mark}`)
    // update without criticReview must not wipe the column (jsonify only touches keys present in the patch)
    const after = await db.selectFrom('shipments').where('id', '=', leg.id).select('criticReview').executeTakeFirst()
    expect(after?.criticReview).toMatchObject({ summary: 'Two HBLs' })

    // linkedPosForBooking
    const po = await seedPo()
    await db.insertInto('bookingPos').values({ bookingId: b, poId: po.id }).execute()
    const linked = await repo.linkedPosForBooking(b)
    expect(linked[0].poNumber).toBeTruthy()
  })

  it('legsForTracker (ACTIVE, not dismissed) + optional state filter', async () => {
    const b = await seedBooking()
    const c = await seedCustomer(`TR${mark}`)
    await db.updateTable('bookings').set({ customerId: c }).where('id', '=', b).execute()
    const a = await seedLeg({ bookingId: b, legNo: 31, state: 'BOOKED' })
    await seedLeg({ bookingId: b, legNo: 32, legStatus: 'SUPERSEDED' }) // excluded (not ACTIVE)
    const dismissed = await seedLeg({ bookingId: b, legNo: 33, state: 'BOOKED', dismissedAt: new Date() })
    const all = await repo.legsForTracker()
    expect(all.find((l) => l.id === a.id)).toBeTruthy()
    expect(all.find((l) => l.id === dismissed.id)).toBeUndefined() // dismissed husks leave the tracker
    const onlySailed = await repo.legsForTracker('SAILED')
    expect(onlySailed.every((l) => l.status === 'SAILED')).toBe(true)
  })

  it('linkPo idempotent + posFor; milestones + milestonesForShipments (batch)', async () => {
    const b = await seedBooking()
    const s = await seedLeg({ bookingId: b })
    const po = await seedPo()
    await repo.linkPo(s.id, po.id, 5, 'cartons')
    await repo.linkPo(s.id, po.id, 5, 'cartons') // duplicate → no-op
    const pos = await repo.posFor(s.id)
    expect(pos.length).toBe(1)

    await repo.replaceMilestones(s.id, [
      { shipmentId: s.id, milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-07-01') },
      { shipmentId: s.id, milestoneType: 'SO_RECEIVED', occurredAt: new Date('2026-07-02') },
    ])
    const ms = await repo.milestonesFor(s.id)
    expect(ms.map((m) => m.milestoneType)).toEqual(['BOOKING_SENT', 'SO_RECEIVED'])
    const batch = await repo.milestonesForShipments([s.id])
    expect(batch.get(s.id)?.length).toBe(2)
    expect((await repo.milestonesForShipments([])).size).toBe(0)
  })

  it('replaceEmails idempotent + sourceGraphIdFor (newest received_at)', async () => {
    const b = await seedBooking()
    const s = await seedLeg({ bookingId: b })
    await repo.replaceEmails(s.id, [
      { shipmentId: s.id, graphMessageId: 'g1', emailType: 'Booking Request', receivedAt: new Date('2026-07-01') },
      { shipmentId: s.id, graphMessageId: 'g2', emailType: 'SO', receivedAt: new Date('2026-07-05') },
    ])
    // re-replace with overlapping gmid → idempotent, no throw
    await repo.replaceEmails(s.id, [{ shipmentId: s.id, graphMessageId: 'g2', emailType: 'SO', receivedAt: new Date('2026-07-05') }])
    const g = await repo.sourceGraphIdFor(s.id)
    expect(g).toBe('g2') // newest received_at
    expect(await repo.sourceGraphIdFor(randomUUID())).toBeNull()
    // in-payload duplicate gmid → deduped to ONE row (uq_shipment_emails), no throw
    await repo.replaceEmails(s.id, [
      { shipmentId: s.id, graphMessageId: 'g3', emailType: 'SO', receivedAt: new Date('2026-07-06') },
      { shipmentId: s.id, graphMessageId: 'g3', emailType: 'SO', receivedAt: new Date('2026-07-06') },
      { shipmentId: s.id, graphMessageId: null, emailType: 'SO', receivedAt: null }, // gmid-less rows are skipped
    ])
    const rows = await db.selectFrom('shipmentEmails').where('shipmentId', '=', s.id).selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].graphMessageId).toBe('g3')
  })

  it('legsByConversationId matches via the computed conversation_key (0033)', async () => {
    const b = await seedBooking()
    const withConv = await repo.insertLeg({
      bookingId: b, legNo: 901, matchKeys: { conversation_id: 'conv-seek-1', customer_po: '28631' },
    })
    await repo.insertLeg({ bookingId: b, legNo: 902, matchKeys: { conversation_id: 'conv-other' } })
    await repo.insertLeg({ bookingId: b, legNo: 903, matchKeys: { customer_po: '28631' } }) // no conversation_id
    const legs = await repo.legsByConversationId('conv-seek-1')
    expect(legs.map((l) => l.id)).toEqual([withConv.id])
    expect(await repo.legsByConversationId('conv-missing')).toEqual([])
  })

  it('activeLegs / findByIds expose firstEmailAt = earliest source-email received_at (#350)', async () => {
    const b = await seedBooking()
    const s = await seedLeg({ bookingId: b, legNo: 61 })
    const bare = await seedLeg({ bookingId: b, legNo: 62 }) // no emails → null (UI falls back to createdAt)
    await repo.replaceEmails(s.id, [
      { shipmentId: s.id, graphMessageId: 'fe-late', emailType: 'SO', receivedAt: new Date('2026-07-05T00:00:00.000Z') },
      { shipmentId: s.id, graphMessageId: 'fe-first', emailType: 'Booking Request', receivedAt: new Date('2026-07-01T00:00:00.000Z') },
      { shipmentId: s.id, graphMessageId: 'fe-undated', emailType: 'SO', receivedAt: null },
    ])
    const active = await repo.activeLegs()
    expect(active.find((l) => l.id === s.id)?.firstEmailAt?.getTime()).toBe(new Date('2026-07-01T00:00:00.000Z').getTime()) // min; undated ignored
    expect(active.find((l) => l.id === bare.id)?.firstEmailAt).toBeNull()
    const byIds = await repo.findByIds([s.id, bare.id])
    expect(byIds.get(s.id)?.firstEmailAt?.getTime()).toBe(new Date('2026-07-01T00:00:00.000Z').getTime())
    expect(byIds.get(bare.id)?.firstEmailAt).toBeNull()
  })

  it('replaceIdentifiers + identifiersFor (current first); replaceParties + partiesFor (primary first)', async () => {
    const b = await seedBooking()
    const s = await seedLeg({ bookingId: b })
    await repo.replaceIdentifiers(s.id, [
      { shipmentId: s.id, type: 'booking_no', value: 'OLD', isCurrent: 0, rank: 1 },
      { shipmentId: s.id, type: 'booking_no', value: 'NEW', isCurrent: 1, rank: 2 },
    ])
    const ids = await repo.identifiersFor(s.id)
    expect(ids[0].isCurrent).toBe(true) // current first (bit → boolean)
    expect(ids[0].value).toBe('NEW')

    await repo.replaceParties(s.id, [
      { shipmentId: s.id, role: 'consignee', customerCode: 'C1', isPrimary: 0, rank: 1 },
      { shipmentId: s.id, role: 'bill_to', customerCode: 'C2', isPrimary: 1, rank: 2 },
    ])
    const parties = await repo.partiesFor(s.id)
    expect(parties[0].isPrimary).toBe(true)
    expect(parties[0].role).toBe('bill_to')
  })

  it('documents() + documentDetail aggregate email types, sender type, PO numbers, received_at (nulls last)', async () => {
    const b = await seedBooking()
    const c = await seedCustomer(`DOC${mark}`)
    await db.updateTable('bookings').set({ customerId: c }).where('id', '=', b).execute()
    const docWithEmail = await seedLeg({ bookingId: b, legNo: 41, kind: 'DOCUMENT', qty: 100, qtyUnit: 'cartons' })
    const docNoEmail = await seedLeg({ bookingId: b, legNo: 42, kind: 'DOCUMENT' }) // received_at null → ordered last

    // wire source emails + a parsed_record (sender_type) + a PO link
    await db.insertInto('shipmentEmails').values({ shipmentId: docWithEmail.id, graphMessageId: 'd1', emailType: 'Booking Request', receivedAt: new Date('2026-07-03') }).execute()
    await db.insertInto('shipmentEmails').values({ shipmentId: docWithEmail.id, graphMessageId: 'd2', emailType: 'SO', receivedAt: new Date('2026-07-05') }).execute()
    await db.insertInto('emailMessage').values({ graphMessageId: 'd2', subject: 's', sender: 's@x.co', receivedAt: new Date('2026-07-05'), attachmentCount: 0 }).execute()
    await db.insertInto('parsedRecord').values({ messageId: (await db.selectFrom('emailMessage').where('graphMessageId', '=', 'd2').select('id').executeTakeFirstOrThrow()).id, graphMessageId: 'd2', senderType: 'forwarder' }).execute()
    const po = await seedPo()
    await repo.linkPo(docWithEmail.id, po.id, 10, 'cartons')

    const rows = await repo.documents()
    const withEmail = rows.find((r) => r.id === docWithEmail.id)!
    expect(withEmail.emailType).toContain('Booking Request')
    expect(withEmail.emailType).toContain('SO')
    expect(withEmail.senderType).toBe('forwarder')
    expect(withEmail.poNumbers).toContain(po.poNumber)
    expect(withEmail.qty).toBe(100)
    expect(withEmail.receivedAt).toBeTruthy()
    // nulls last: the doc with no email (null received_at) sorts after the dated one
    const noEmail = rows.find((r) => r.id === docNoEmail.id)
    expect(noEmail?.receivedAt).toBeNull()
    const withIdx = rows.findIndex((r) => r.id === docWithEmail.id)
    const noIdx = rows.findIndex((r) => r.id === docNoEmail.id)
    expect(withIdx).toBeLessThan(noIdx)

    const detail = await repo.documentDetail(docWithEmail.id)
    expect(detail?.poNumbers).toContain(po.poNumber)
    expect(detail?.emailId).toBeTruthy() // the newest source email_message id

    // dismiss → drops off the list
    await repo.dismissDocument(docWithEmail.id)
    const after = await repo.documents()
    expect(after.find((r) => r.id === docWithEmail.id)).toBeUndefined()
  })

  it('kindOf + linkDocument copies POs + emails onto the target (idempotent) + stamps linkedShipmentId', async () => {
    const targetB = await seedBooking()
    const target = await seedLeg({ bookingId: targetB, kind: 'SHIPMENT' })
    const docB = await seedBooking()
    const doc = await seedLeg({ bookingId: docB, kind: 'DOCUMENT' })

    expect(await repo.kindOf(target.id)).toBe('SHIPMENT')
    expect(await repo.kindOf(doc.id)).toBe('DOCUMENT')
    expect(await repo.kindOf(randomUUID())).toBeNull()

    const po = await seedPo()
    await repo.linkPo(doc.id, po.id, 3, 'cartons')
    await db.insertInto('shipmentEmails').values({ shipmentId: doc.id, graphMessageId: 'ld1', emailType: 'SO', receivedAt: new Date() }).execute()

    await repo.linkDocument(doc.id, target.id)
    // POs + emails copied onto the target
    expect((await repo.posFor(target.id)).find((p) => p.poId === po.id)).toBeTruthy()
    const targetEmails = await db.selectFrom('shipmentEmails').where('shipmentId', '=', target.id).selectAll().execute()
    expect(targetEmails.find((e) => e.graphMessageId === 'ld1')).toBeTruthy()
    // document stamped + leaves the unlinked list
    expect((await repo.findById(doc.id))?.linkedShipmentId?.toLowerCase()).toBe(target.id.toLowerCase())
    expect((await repo.documents()).find((r) => r.id === doc.id)).toBeUndefined()
    // idempotent: a second linkDocument must not throw or duplicate
    await repo.linkDocument(doc.id, target.id)
    expect((await repo.posFor(target.id)).filter((p) => p.poId === po.id).length).toBe(1)
  })
})
