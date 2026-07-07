import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

let db: TestDB
let committer: CommitterService

const group = (over: Partial<ReconGroup> = {}): ReconGroup => ({
  fields: {},
  pos: ['PO-1'],
  matchKeys: { so_no: 'SO-1' },
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
  mode: 'Sea-LCL',
  conversationId: 'conv-1',
  conflicts: [],
  evidenceIds: ['ev-1'],
  ...over,
})

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('CommitterService (integration, real Postgres)', () => {
  it('creates a booking + leg from a group, mapping fields and deriving state', async () => {
    const res = await committer.apply(group({ fields: { so_no: 'SO-1', hbl_awb_fcr_no: 'H-1' }, emailTypes: ['SO'] }))
    expect(res.action).toBe('create_booking')
    expect(res.state).toBe('CONFIRMED')
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.soNo).toBe('SO-1')
    expect(leg.mode).toBe('SEA_LCL')
    expect(await db.select().from(schema.bookings)).toHaveLength(1)
  })

  it('is idempotent: the same group twice updates one leg (no duplicate booking)', async () => {
    const g = group({ fields: { so_no: 'SO-9' } })
    const a = await committer.apply(g)
    const b = await committer.apply(g)
    expect(b.action).toBe('amend_fields')
    expect(b.bookingId).toBe(a.bookingId)
    expect(await db.select().from(schema.bookings)).toHaveLength(1)
    expect(await db.select().from(schema.shipments)).toHaveLength(1)
  })

  it('human-wins: a locked field is never overwritten by the agent', async () => {
    const a = await committer.apply(group({ fields: { so_no: 'AGENT-SO' } }))
    await db.update(schema.shipments).set({ soNo: 'HUMAN-SO' }).where(eq(schema.shipments.id, a.shipmentId))
    await db
      .insert(schema.fieldLocks)
      .values({ entityType: 'shipment', entityId: a.shipmentId, field: 'soNo', lockedValue: 'HUMAN-SO' })
    const b = await committer.apply(group({ fields: { so_no: 'AGENT-SO-2' } }))
    expect(b.skippedLockedFields).toContain('soNo')
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId))
    expect(leg.soNo).toBe('HUMAN-SO')
  })

  it('PO-guard: a shared strong key but a different PO does NOT merge bookings', async () => {
    await committer.apply(group({ pos: ['PO-A'], matchKeys: { so_no: 'SAME' } }))
    const res = await committer.apply(group({ pos: ['PO-B'], matchKeys: { so_no: 'SAME' } }))
    expect(res.action).toBe('create_booking')
    expect(await db.select().from(schema.bookings)).toHaveLength(2)
  })

  it('writes an audit row on create', async () => {
    await committer.apply(group())
    const audit = await db.select().from(schema.changeLog)
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.some((a) => a.changeType === 'create' && a.sourceType === 'agent')).toBe(true)
  })
})

describe('CommitterService — per-PO enrichment from parsed evidence (integration)', () => {
  /** Seed one parsed_record (email × PO) with its queue_message received time. */
  async function seedRecord(over: {
    graphMessageId: string
    receivedAt: string
    poNo: string | null
    fields: Record<string, unknown>
    matchKeys?: Record<string, unknown>
    recordIdx?: number
  }) {
    const [msg] = await db
      .insert(schema.queueMessage)
      .values({ graphMessageId: over.graphMessageId, receivedAt: new Date(over.receivedAt) })
      .returning()
    await db.insert(schema.parsedRecord).values({
      messageId: msg.id,
      recordIdx: over.recordIdx ?? 0,
      poNo: over.poNo,
      fields: over.fields,
      matchKeys: over.matchKeys ?? {},
    })
  }

  const poRow = async (poNumber: string) => {
    const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.poNumber, poNumber))
    return po
  }

  it('enriches the PO with per-PO brand/item_style_no/total_quantity(+unit) from the matching parsed_record', async () => {
    await seedRecord({ graphMessageId: 'g-1', receivedAt: '2026-06-30T05:00:00Z', poNo: 'PO-ENR', fields: { brand: 'FENIX', item_style_no: '43079', qty: '24', qty_unit: 'cartons' } })
    await committer.apply(group({ pos: ['PO-ENR'], matchKeys: { so_no: 'SO-ENR' } }))
    const po = await poRow('PO-ENR')
    expect(po.brand).toBe('FENIX')
    expect(po.itemStyleNo).toBe('43079')
    expect(po.totalQuantity).toBe(24)
    expect(po.quantityUnit).toBe('cartons')
  })

  it('does NOT leak a shipment/SO-level brand (record with no PO) onto the numeric POs', async () => {
    // The real leak: 'Barbour' is stated on an SO-level record with no PO; PO 4483233 has no brand of its own.
    await seedRecord({ graphMessageId: 'g-so', receivedAt: '2026-06-30T05:00:00Z', poNo: null, fields: { brand: 'Barbour' }, matchKeys: { so_no: '26SZ10066152' } })
    await seedRecord({ graphMessageId: 'g-po', receivedAt: '2026-06-30T05:01:00Z', poNo: '4483233', fields: { item_style_no: 'ABC' }, matchKeys: { customer_po: '4483233', so_no: '26SZ10066152' } })
    await committer.apply(group({ pos: ['4483233'], matchKeys: { so_no: '26SZ10066152' } }))
    const po = await poRow('4483233')
    expect(po.brand).toBeNull() // never 'Barbour'
    expect(po.itemStyleNo).toBe('ABC')
  })

  it('latest-received email wins when the same PO carries two brand labels', async () => {
    await seedRecord({ graphMessageId: 'g-old', receivedAt: '2026-06-01T00:00:00Z', poNo: 'PO-LEAK', fields: { brand: 'Barbour' } })
    await seedRecord({ graphMessageId: 'g-new', receivedAt: '2026-06-02T00:00:00Z', poNo: 'PO-LEAK', fields: { brand: 'FENIX' } })
    await committer.apply(group({ pos: ['PO-LEAK'], matchKeys: { so_no: 'SO-LEAK' } }))
    expect((await poRow('PO-LEAK')).brand).toBe('FENIX')
  })

  it('fill-if-null: a human/ERP-set PO field is never overwritten by the agent (mirrors fillBooking)', async () => {
    await seedRecord({ graphMessageId: 'g-h', receivedAt: '2026-06-30T05:00:00Z', poNo: 'PO-HUMAN', fields: { brand: 'FENIX', item_style_no: 'S1' } })
    await committer.apply(group({ pos: ['PO-HUMAN'], matchKeys: { so_no: 'SO-H1' } }))
    expect((await poRow('PO-HUMAN')).brand).toBe('FENIX') // first commit enriches the empty column
    // a human corrects the brand, then a fresh (newer) email restates the parsed brand
    await db.update(schema.purchaseOrders).set({ brand: 'HUMAN BRAND' }).where(eq(schema.purchaseOrders.poNumber, 'PO-HUMAN'))
    await seedRecord({ graphMessageId: 'g-h2', receivedAt: '2026-06-30T06:00:00Z', poNo: 'PO-HUMAN', fields: { brand: 'FENIX-NEW', item_style_no: 'S2' } })
    await committer.apply(group({ pos: ['PO-HUMAN'], matchKeys: { so_no: 'SO-H2' } }))
    const po = await poRow('PO-HUMAN')
    expect(po.brand).toBe('HUMAN BRAND') // human value preserved (never overwritten)
    expect(po.itemStyleNo).toBe('S1') // style was already filled on the first commit → not re-touched
  })
})

describe('CommitterService — co-valid customer parties (integration)', () => {
  // master_resolution is NOT in resetDb's truncate list → clear it + seed customers per test
  async function seedAEGroup(extraCustomers: { code: string; name: string }[] = []) {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([
      { code: 'AEOW', name: 'AEO MANAGEMENT CO.' },
      { code: 'BLUI', name: 'BLUE STAR IMPORTS L.P.' },
      ...extraCustomers,
    ])
    await db.insert(schema.masterResolution).values([
      { kind: 'customer_group', lhs: 'AEOW', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
      { kind: 'customer_group', lhs: 'BLUI', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
      { kind: 'customer_role', lhs: 'AEOW', rhs: 'bill_to', status: 'approved', source: 'seed' },
      { kind: 'customer_role', lhs: 'BLUI', rhs: 'importer_of_record', status: 'approved', source: 'seed' },
    ])
  }

  it('persists bill-to + IOR as parties, primary = bill_to, and DROPS an unrelated party', async () => {
    await seedAEGroup([{ code: 'FENIX', name: 'FENIX OUTDOOR' }])
    const res = await committer.apply(group({
      fields: { customer_code: 'AEOW', so_no: 'SO-AE' },
      matchKeys: { so_no: 'SO-AE' },
      entities: [
        { type: 'customer_code', value: 'AEOW', role: 'bill_to', isPrimary: true, docType: 'Invoice/Billing', rank: 1 },
        { type: 'customer_code', value: 'BLUI', role: 'importer_of_record', isPrimary: false, docType: 'Final B/L', rank: 5 },
        { type: 'customer_code', value: 'FENIX', role: 'other', isPrimary: false, docType: 'Customs', rank: 1 }, // UNRELATED → dropped
      ],
    }))
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, res.shipmentId))
    expect(parties.map((p) => p.customerCode).sort()).toEqual(['AEOW', 'BLUI']) // FENIX dropped (no shared group)
    expect(parties.find((p) => p.customerCode === 'AEOW')?.isPrimary).toBe(true)
    expect(parties.find((p) => p.customerCode === 'BLUI')?.isPrimary).toBe(false)
    // booking.customer_id = the bill_to primary (AEOW), never the IOR
    const [bk] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId))
    const [aeow] = await db.select().from(schema.customers).where(eq(schema.customers.code, 'AEOW'))
    expect(bk.customerId).toBe(aeow.id)
  })

  it('re-applying the same decision is idempotent (no duplicate party rows)', async () => {
    await seedAEGroup()
    const g = group({
      fields: { customer_code: 'AEOW', so_no: 'SO-IDEM' },
      matchKeys: { so_no: 'SO-IDEM' },
      entities: [
        { type: 'customer_code', value: 'AEOW', role: 'bill_to', isPrimary: true },
        { type: 'customer_code', value: 'BLUI', role: 'importer_of_record', isPrimary: false },
      ],
    })
    const a = await committer.apply(g)
    await committer.apply(g)
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, a.shipmentId))
    expect(parties).toHaveLength(2)
  })

  it('folds an alias (COLEB→COLE) onto booking.customer_id via canonical resolution', async () => {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([{ code: 'COLE', name: 'COLE BUXTON LTD' }])
    await db.insert(schema.masterResolution).values([
      { kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', status: 'approved', source: 'seed' },
    ])
    const res = await committer.apply(group({ fields: { customer_code: 'COLEB', so_no: 'SO-COLE' }, matchKeys: { so_no: 'SO-COLE' } }))
    const [bk] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId))
    const [cole] = await db.select().from(schema.customers).where(eq(schema.customers.code, 'COLE'))
    expect(bk.customerId).toBe(cole.id) // COLEB resolved to COLE's id
  })

  it('writes no parties when the decision carries none (legacy/single-customer)', async () => {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([{ code: 'DOCC', name: 'DOCLASSE' }])
    const res = await committer.apply(group({ fields: { customer_code: 'DOCC', so_no: 'SO-SINGLE' }, matchKeys: { so_no: 'SO-SINGLE' } }))
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, res.shipmentId))
    expect(parties).toHaveLength(0)
  })
})

describe('CommitterService — empty-cargo review flag (integration)', () => {
  const reasons = (leg: { reviewReasons?: string[] | null }) => leg.reviewReasons ?? []
  const hasCargoFlag = (leg: { reviewReasons?: string[] | null }) => reasons(leg).some((r) => /missing cargo detail/i.test(r))

  it('a real booked leg that names a cargo UNIT but has no qty/weight/volume is routed to review', async () => {
    // exactly the S2600240871A case: qty_unit='cartons' survived the reply body, but the numbers lived in
    // the booking attachment that was never ingested → qty/gross_weight/measurement all null
    const res = await committer.apply(group({
      matchKeys: { booking_no: 'BKCARGO1' },
      pos: ['PO-CARGO1'],
      fields: { booking_no: 'BKCARGO1', qty_unit: 'cartons' },
    }))
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.reviewStatus).toBe('provisional')
    expect(hasCargoFlag(leg)).toBe(true)
  })

  it('a leg WITH cargo numbers is NOT flagged for missing cargo', async () => {
    const res = await committer.apply(group({
      matchKeys: { booking_no: 'BKCARGO2' },
      pos: ['PO-CARGO2'],
      fields: { booking_no: 'BKCARGO2', qty: 100, qty_unit: 'cartons' },
    }))
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(hasCargoFlag(leg)).toBe(false)
  })

  it('a nascent booking with NO cargo unit at all is NOT flagged (avoids over-flagging normal early bookings)', async () => {
    const res = await committer.apply(group({
      matchKeys: { booking_no: 'BKCARGO3' },
      pos: ['PO-CARGO3'],
      fields: { booking_no: 'BKCARGO3' },
    }))
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(hasCargoFlag(leg)).toBe(false)
  })
})

describe('CommitterService — CVP notification-platform legs → DOCUMENT (integration)', () => {
  /** Seed a queue_message (the source email) with a graph id + sender, so the committer can resolve
   *  whether the leg was built entirely from the notification platform on the agent path. */
  async function seedEmail(graphMessageId: string, sender: string) {
    await db
      .insert(schema.queueMessage)
      .values({ graphMessageId, sender, receivedAt: new Date('2026-07-01T08:22:00Z') })
  }

  const cvpGroup = (over: Partial<ReconGroup> = {}): ReconGroup =>
    group({
      fields: { booking_no: 'FENLPO003034A' }, // the portal's LPO ref leaked into booking_no — its only "identity"
      matchKeys: { booking_no: 'FENLPO003034A' },
      emailTypes: ['Other'],
      events: [{ emailType: 'Other', receivedAt: '2026-07-01T08:22:00Z', graphId: 'cvp-1' }],
      pos: ['120003616'],
      ...over,
    })

  it("agent path: a leg built entirely from the CVP platform's emails commits as kind=DOCUMENT", async () => {
    await seedEmail('cvp-1', 'notify.noreply2@tradelinkone.com')
    const res = await committer.apply(cvpGroup()) // fromPlatform unset → committer resolves it from the sender
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.kind).toBe('DOCUMENT')
  })

  it('the SAME leg from a real forwarder sender stays kind=SHIPMENT (booking# is a booked move)', async () => {
    await seedEmail('cvp-1', 'ops@realforwarder.com')
    const res = await committer.apply(cvpGroup())
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.kind).toBe('SHIPMENT')
  })

  it('a platform leg that also carries a real MBL stays kind=SHIPMENT (a booked move the notice reports)', async () => {
    await seedEmail('cvp-1', 'notify.noreply2@tradelinkone.com')
    const res = await committer.apply(cvpGroup({ fields: { booking_no: 'FENLPO003034A', mbl: 'WHLC12345' } }))
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.kind).toBe('SHIPMENT')
  })

  it('rebuild path: an explicit fromPlatform=true demotes without needing to resolve senders', async () => {
    const res = await committer.apply(cvpGroup({ fromPlatform: true, events: [{ emailType: 'Other', receivedAt: '2026-07-01T08:22:00Z' }] }))
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.kind).toBe('DOCUMENT')
  })
})
