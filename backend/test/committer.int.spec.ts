import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'
import { journeyRoute } from '../src/presentation/adapters/derive'

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
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('CommitterService (integration, real SQL Server)', () => {
  it('🔴 a PO split keeps its shipments on DIFFERENT IDs, each with its OWN journey', async () => {
    // John's scenario, pinned end-to-end (2026-08-03): one PO, two movements —
    //   ① A→B→C on one air waybill (a transit chain)   ② A→D by sea on its own bill (direct)
    // The two groups share ONLY the PO; their strong keys are their own documents. They must land on
    // two distinct shipment ids, and the air chain must never bleed onto the sea leg's route.
    const air = await committer.apply(group({
      pos: ['PO-5000'],
      matchKeys: { hbl_awb_fcr_no: 'AWB-777' },
      mode: 'Air',
      emailTypes: ['SO'],
      fields: { hbl_awb_fcr_no: 'AWB-777', pol: 'A', pod: 'C' },
      journey: [
        { seq: 1, mode: 'Air', pol: 'A', pod: 'B', doc: 'AWB-777' },
        { seq: 2, mode: 'Air', pol: 'B', pod: 'C', doc: null },
      ],
      conversationId: 'conv-air',
      evidenceIds: ['ev-air'],
    }))
    const sea = await committer.apply(group({
      pos: ['PO-5000'],
      matchKeys: { mbl: 'MBL-888' },
      mode: 'Sea-FCL',
      emailTypes: ['SO'],
      fields: { mbl: 'MBL-888', pol: 'A', pod: 'D' },
      // a direct A→D is ONE movement — the queue's normalizeLegs nulls a single-leg array upstream,
      // so no journey rides this decision at all
      conversationId: 'conv-sea',
      evidenceIds: ['ev-sea'],
    }))

    expect(sea.shipmentId).not.toBe(air.shipmentId)

    const legAir = await db.selectFrom('shipments').where('id', '=', air.shipmentId).selectAll().executeTakeFirstOrThrow()
    const legSea = await db.selectFrom('shipments').where('id', '=', sea.shipmentId).selectAll().executeTakeFirstOrThrow()
    // the chain lives on the AIR leg only, and renders as the multi-stop route
    expect(journeyRoute((legAir as { journey?: unknown }).journey)).toBe('A→B→C')
    // the SEA leg has no journey — its route falls back to plain pol→pod (A→D)
    expect((legSea as { journey?: string | null }).journey ?? null).toBeNull()
    expect(legSea.mbl).toBe('MBL-888')
    expect(legAir.hblAwbFcrNo).toBe('AWB-777')
  })

  it('🔴 a stated division removes the moved PO from the leg it left — audited, never silent', async () => {
    // Day-10 of the regroup lifecycle: C,D booked on Osaka; a later email states D moved to the London
    // booking. The queue's decision for the Osaka leg now carries pos=[C] AND the division naming D —
    // the two together are the committer's licence to drop D's stated link. Absence alone must not.
    const osaka = group({
      pos: ['PO-C', 'PO-D'],
      matchKeys: { booking_no: 'BK-OSA' },
      fields: { booking_no: 'BK-OSA', pod: 'Osaka' },
      conversationId: 'conv-osa',
    })
    const a = await committer.apply(osaka)
    const linked = (id: string) => db.selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .where('shipmentPos.shipmentId', '=', id)
      .select('purchaseOrders.poNumber as poNumber').execute()
    expect((await linked(a.shipmentId)).map((r) => r.poNumber).sort()).toEqual(['PO-C', 'PO-D'])

    const b = await committer.apply(group({
      ...osaka,
      pos: ['PO-C'],
      divisions: [{ pos: ['PO-D'], direction: 'to', target: 'BK-LON', quote: 'PO D 改到伦敦 booking' }],
      events: [{ emailType: 'Booking Request', receivedAt: '2026-01-10T00:00:00Z' }],
    }))
    expect(b.shipmentId).toBe(a.shipmentId) // same leg amended, not a new one
    expect((await linked(a.shipmentId)).map((r) => r.poNumber)).toEqual(['PO-C'])
    // the removal is audited with the statement's own words — a PO leaving a leg is never silent
    const audit = await db.selectFrom('changeLog').selectAll().execute()
    const row = audit.find((x) => x.field === 'shipment_pos' && x.changeType === 'delete' && x.oldValue === 'PO-D')
    expect(row?.note).toContain('改到伦敦')
  })

  it('🔴 operator lifecycle: dismiss the thin leg, hand-type the real one — the next email finds the REAL one', async () => {
    // Measured before the rank fix: the keyed email landed on whichever row the unordered SQL returned
    // first — half the time the dismissed husk, absorbing the data invisibly.
    const thin = await committer.apply(group({
      pos: ['PO-77'], matchKeys: {}, fields: {}, conversationId: 'conv-thin', evidenceIds: ['ev-thin'],
    }))
    await db.updateTable('shipments').set({ dismissedAt: new Date() }).where('id', '=', thin.shipmentId).execute()

    const manual = await committer.apply(group({
      pos: ['PO-77'],
      matchKeys: { booking_no: 'BK-M', so_no: 'SO-M' },
      fields: { booking_no: 'BK-M', so_no: 'SO-M', pol: 'SZX', pod: 'LHR' },
      conversationId: null, createdManually: true, reviewStatus: 'provisional', evidenceIds: [],
    }))
    expect(manual.shipmentId).not.toBe(thin.shipmentId)

    // the forwarder's next email names the manual leg's exact booking + SO
    const keyed = await committer.apply(group({
      pos: ['PO-77'],
      matchKeys: { booking_no: 'BK-M', so_no: 'SO-M' },
      fields: { booking_no: 'BK-M', etd: '2026-06-20' },
      conversationId: 'conv-fwd', evidenceIds: ['ev-fwd'],
    }))
    expect(keyed.shipmentId).toBe(manual.shipmentId)

    // and a PO-only follow-up prefers the LIVE manual leg over the dismissed husk
    const poOnly = await committer.apply(group({
      pos: ['PO-77'], matchKeys: {}, fields: {}, conversationId: 'conv-follow', evidenceIds: ['ev-follow'],
    }))
    expect(poOnly.shipmentId).toBe(manual.shipmentId)
  })

  it('🔴 split PO on two live shipments: a PO-only email matches NEITHER — it lands provisional, naming both', async () => {
    const ac = await committer.apply(group({
      pos: ['PO-88'], matchKeys: { booking_no: 'BK-C' }, fields: { booking_no: 'BK-C', pod: 'C' },
      conversationId: 'conv-c', evidenceIds: ['ev-c'],
    }))
    const ab = await committer.apply(group({
      pos: ['PO-88'], matchKeys: { booking_no: 'BK-B' }, fields: { booking_no: 'BK-B', pod: 'B' },
      conversationId: 'conv-b', evidenceIds: ['ev-b'],
    }))
    expect(ab.shipmentId).not.toBe(ac.shipmentId)

    const poOnly = await committer.apply(group({
      pos: ['PO-88'], matchKeys: {}, fields: {}, conversationId: 'conv-p', evidenceIds: ['ev-p'],
    }))
    expect([ac.shipmentId, ab.shipmentId]).not.toContain(poOnly.shipmentId)
    const leg = await db.selectFrom('shipments').where('id', '=', poOnly.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.reviewStatus).toBe('provisional')
    // the desk sees BOTH candidates by job number, and the phrase tells it what to do
    expect(String(leg.reviewReasons)).toContain('could belong to either shipment')
    expect(String(leg.reviewReasons)).toContain('PO-88')

    // idempotency: a re-POST (or rebuild replay) of the same decision lands back on its own leg
    const again = await committer.apply(group({
      pos: ['PO-88'], matchKeys: {}, fields: {}, conversationId: 'conv-p', evidenceIds: ['ev-p'],
    }))
    expect(again.shipmentId).toBe(poOnly.shipmentId)
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(3)
  })

  it('a thin decision WITHOUT a division never strips cargo — absence alone is not evidence', async () => {
    const osaka = group({
      pos: ['PO-C', 'PO-D'],
      matchKeys: { booking_no: 'BK-OSA2' },
      fields: { booking_no: 'BK-OSA2' },
      conversationId: 'conv-osa2',
    })
    const a = await committer.apply(osaka)
    await committer.apply(group({ ...osaka, pos: ['PO-C'] })) // e.g. a partial reparse — no statement
    const pos = await db.selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .where('shipmentPos.shipmentId', '=', a.shipmentId)
      .select('purchaseOrders.poNumber as poNumber').execute()
    expect(pos.map((r) => r.poNumber).sort()).toEqual(['PO-C', 'PO-D'])
  })

  it('creates a booking + leg from a group, mapping fields and deriving state', async () => {
    const res = await committer.apply(group({ fields: { so_no: 'SO-1', hbl_awb_fcr_no: 'H-1' }, emailTypes: ['SO'] }))
    expect(res.action).toBe('create_booking')
    expect(res.state).toBe('CONFIRMED')
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.soNo).toBe('SO-1')
    expect(leg.mode).toBe('SEA') // normMode collapses every sea variant (0023)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('is idempotent: the same group twice updates one leg (no duplicate booking)', async () => {
    const g = group({ fields: { so_no: 'SO-9' } })
    const a = await committer.apply(g)
    const b = await committer.apply(g)
    expect(b.action).toBe('amend_fields')
    expect(b.bookingId).toBe(a.bookingId)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1)
  })

  it('persists identifier history (cross-type dedup + is_current) and is idempotent on re-apply', async () => {
    const g = group({
      fields: { booking_no: 'BK-1', so_no: 'SO-1' },
      matchKeys: { booking_no: 'BK-1' },
      identifiers: [
        { type: 'booking_no', value: 'BK-1', isCurrent: true },
        { type: 'so_no', value: 'BK-1' }, // SAME value as booking_no → cross-type deduped (kept under booking_no)
        { type: 'so_no', value: 'SO-1' },
        { type: 'container_no', value: 'CT-1' },
      ],
    })
    const res = await committer.apply(g)
    const idRows = () =>
      db.selectFrom('shipmentIdentifiers').where('shipmentId', '=', res.shipmentId).selectAll().execute()
    const rows1 = await idRows()
    // BK-1 kept ONLY under booking_no (so_no:BK-1 dropped by cross-type dedup); so_no:SO-1 + container_no:CT-1 survive
    expect(rows1.map((r) => `${r.type}:${r.value}`).sort()).toEqual(['booking_no:BK-1', 'container_no:CT-1', 'so_no:SO-1'])
    // is_current: booking_no BK-1 equals the committed column → current
    expect(rows1.find((r) => r.type === 'booking_no')!.isCurrent).toBe(true)

    // idempotent (delete+insert per shipment): re-applying the same decision never piles up duplicate rows
    await committer.apply(g)
    expect(await idRows()).toHaveLength(rows1.length)
  })

  it('latest-email-wins: a newer email overrides a human-locked field and flags it CONTESTED', async () => {
    const a = await committer.apply(group({ fields: { so_no: 'AGENT-SO' } }))
    await db.updateTable('shipments').set({ soNo: 'HUMAN-SO' }).where('id', '=', a.shipmentId).execute()
    await db
      .insertInto('fieldLocks')
      .values({ entityType: 'shipment', entityId: a.shipmentId, field: 'soNo', lockedValue: 'HUMAN-SO' })
      .execute()
    const b = await committer.apply(group({ fields: { so_no: 'AGENT-SO-2' } }))
    // the newer email value is APPLIED so tracking stays current (no silent staleness)...
    expect(b.supersededLockedFields).toContain('soNo')
    const leg = await db.selectFrom('shipments').where('id', '=', a.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.soNo).toBe('AGENT-SO-2')
    // ...but the lock still holds the human value → column != lockedValue → CONTESTED (surfaced for review)
    const lock = await db
      .selectFrom('fieldLocks')
      .where('entityId', '=', a.shipmentId)
      .where('field', '=', 'soNo')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(lock.lockedValue).toBe('HUMAN-SO')
  })

  it('PO-guard: a shared strong key but a different PO does NOT merge bookings', async () => {
    await committer.apply(group({ pos: ['PO-A'], matchKeys: { so_no: 'SAME' } }))
    const res = await committer.apply(group({ pos: ['PO-B'], matchKeys: { so_no: 'SAME' } }))
    expect(res.action).toBe('create_booking')
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(2)
  })

  it('writes an audit row on create', async () => {
    await committer.apply(group())
    const audit = await db.selectFrom('changeLog').selectAll().execute()
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.some((a) => a.changeType === 'create' && a.sourceType === 'agent')).toBe(true)
  })

  it('rule 5: a later-learned booking brand lands in the change-history (booking-only field, no leg column)', async () => {
    // create with no brand, then a later email states one → fillBooking fills booking.brand. Without an
    // audit there, brand (which has no shipments column) would never appear in the change-history.
    const a = await committer.apply(group({ fields: { so_no: 'SO-BR' }, matchKeys: { so_no: 'SO-BR' } }))
    const b = await committer.apply(group({ fields: { so_no: 'SO-BR', brand: 'FENIX' }, matchKeys: { so_no: 'SO-BR' } }))
    expect(b.shipmentId).toBe(a.shipmentId) // same leg (amend)
    const brandRow = (await db.selectFrom('changeLog').where('entityId', '=', a.shipmentId).selectAll().execute())
      .find((r) => r.field === 'brand')
    expect(brandRow?.newValue).toBe('FENIX')
    expect(brandRow?.changeType).toBe('update')
    // and it actually landed on the booking
    const bk = await db.selectFrom('bookings').where('id', '=', a.bookingId).selectAll().executeTakeFirstOrThrow()
    expect(bk.brand).toBe('FENIX')
  })

  it('#133 multi-HBL email: conflicting strong ids never fuse, even with a shared PO and no booking/SO', async () => {
    // The KOHL/YAQI thread: one email, five invoices, booking_no/so_no null on (almost) every doc,
    // identity lives in per-attachment HBL+container+MBL. PO 16068229 is split across two containers.
    const legA = { hbl: 'SE26061400003', cont: 'ONEU0429500', mbl: 'ONEYDACG13378900', pos: ['16068176', '16068227'] }
    const legB = { hbl: 'SE26061400001', cont: 'TRHU5378918', mbl: 'ONEYDACG13380900', pos: ['16068229'] }
    const legC = { hbl: 'SE26061400005', cont: 'ONEU1375780', mbl: 'ONEYDACG13372300', pos: ['16068229', '16068195'], so: 'OI-22604713' }
    const asGroup = (l: { hbl: string; cont: string; mbl: string; pos: string[]; so?: string }) =>
      group({
        pos: l.pos,
        matchKeys: { hbl_awb_fcr_no: l.hbl, container_no: l.cont, mbl: l.mbl, ...(l.so ? { so_no: l.so } : {}) },
        fields: { hbl_awb_fcr_no: l.hbl, container_no: l.cont, mbl: l.mbl, ...(l.so ? { so_no: l.so } : {}) },
        emailTypes: ['Final B/L'],
        events: [{ emailType: 'Final B/L', receivedAt: '2026-07-13T10:45:52Z' }],
        conversationId: 'conv-kohl-yaqi',
      })

    const a = await committer.apply(asGroup(legA))
    const b = await committer.apply(asGroup(legB))
    const c = await committer.apply(asGroup(legC))

    expect(b.action).toBe('create_booking') // same thread must not fuse
    expect(c.action).toBe('create_booking') // PO 16068229 also on legB — conflicting HBL/container wins
    expect(new Set([a.shipmentId, b.shipmentId, c.shipmentId]).size).toBe(3)

    // Cross-HAWB PO exclusivity: first claimant (legB) keeps PO 16068229; legC (different HBL)
    // does not dual-link — planPoReconcile sibling skip (same policy as DEMO dual GZL).
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', '16068229').selectAll().executeTakeFirstOrThrow()
    const links = await db.selectFrom('bookingPos').where('poId', '=', po.id).selectAll().execute()
    expect(new Set(links.map((l) => l.bookingId))).toEqual(new Set([b.bookingId]))
    // legC still created as its own booking/leg (HBL conflict), just without that PO link
    expect(c.bookingId).not.toBe(b.bookingId)

    // idempotency: re-applying legB amends legB — it never leaks onto legC via the shared PO
    const b2 = await committer.apply(asGroup(legB))
    expect(b2.action).toBe('amend_fields')
    expect(b2.shipmentId).toBe(b.shipmentId)
  })
})

describe('CommitterService — strong-key index (shipment_match_keys) write side (integration)', () => {
  const indexPairs = async (shipmentId: string) =>
    (await db.selectFrom('shipmentMatchKeys').where('shipmentId', '=', shipmentId).selectAll().execute())
      .map((r) => `${r.type}:${r.value}`)
      .sort()

  it('persists a NORMALIZED strong-key row per leg from match_keys (independent of g.identifiers)', async () => {
    // no `identifiers` on the group at all — the index must still populate (proves it derives from match_keys,
    // i.e. it works on the rebuild path too, where g.identifiers is never set)
    const res = await committer.apply(group({ matchKeys: { booking_no: 'BK-1', so_no: 'SO-1' }, pos: [] }))
    expect(await indexPairs(res.shipmentId)).toEqual(['booking_no:BK1', 'so_no:SO1']) // '-' stripped, upper-cased
  })

  it('only the five strong keys are indexed — customer_po / conversation_id are not', async () => {
    const res = await committer.apply(group({ matchKeys: { so_no: 'SO-X', customer_po: 'PO-9' }, conversationId: 'conv-x', pos: [] }))
    expect(await indexPairs(res.shipmentId)).toEqual(['so_no:SOX'])
  })

  it('is idempotent: re-applying the same decision never piles up duplicate index rows', async () => {
    const g = group({ matchKeys: { booking_no: 'BK-IDEM' }, pos: [] })
    const res = await committer.apply(g)
    await committer.apply(g)
    expect(await indexPairs(res.shipmentId)).toEqual(['booking_no:BKIDEM'])
  })

  it('amend: a strong key added by a later email is reflected in the index (mirrors the leg match_keys)', async () => {
    const a = await committer.apply(group({ matchKeys: { so_no: 'SO-GROW' }, pos: [] }))
    const b = await committer.apply(group({ matchKeys: { so_no: 'SO-GROW', booking_no: 'BK-GROW' }, pos: [] }))
    expect(b.shipmentId).toBe(a.shipmentId) // same leg (amended by so_no overlap)
    expect(await indexPairs(a.shipmentId)).toEqual(['booking_no:BKGROW', 'so_no:SOGROW'])
  })
})

describe('CommitterService — per-PO enrichment from parsed evidence (integration)', () => {
  /** Seed one parsed_record (email × PO) with its email_message received time. */
  async function seedRecord(over: {
    graphMessageId: string
    receivedAt: string
    poNo: string | null
    fields: Record<string, unknown>
    matchKeys?: Record<string, unknown>
    recordIdx?: number
  }) {
    const msg = await db
      .insertInto('emailMessage')
      .values({ graphMessageId: over.graphMessageId, receivedAt: new Date(over.receivedAt) })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    // graphMessageId is set like production ingest does (SQL Server UNIQUE (gmid, record_idx) treats NULLs
    // as equal, so NULL-gmid rows — fine on Postgres — would collide here)
    const mk = over.matchKeys ?? {}
    // po_no_norm = same key resolvePoEnrichment uses (normKey(po_no)||normKey(customer_po)) — production ingest writes it.
    const poNoNorm =
      String(over.poNo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') ||
      String(mk.customer_po ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') ||
      null
    await db
      .insertInto('parsedRecord')
      .values({
        messageId: msg.id,
        graphMessageId: over.graphMessageId,
        recordIdx: over.recordIdx ?? 0,
        poNo: over.poNo,
        poNoNorm,
        fields: JSON.stringify(over.fields),
        matchKeys: JSON.stringify(mk),
      })
      .execute()
  }

  const poRow = (poNumber: string) =>
    db.selectFrom('purchaseOrders').where('poNumber', '=', poNumber).selectAll().executeTakeFirstOrThrow()

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
    await db.updateTable('purchaseOrders').set({ brand: 'HUMAN BRAND' }).where('poNumber', '=', 'PO-HUMAN').execute()
    await seedRecord({ graphMessageId: 'g-h2', receivedAt: '2026-06-30T06:00:00Z', poNo: 'PO-HUMAN', fields: { brand: 'FENIX-NEW', item_style_no: 'S2' } })
    await committer.apply(group({ pos: ['PO-HUMAN'], matchKeys: { so_no: 'SO-H2' } }))
    const po = await poRow('PO-HUMAN')
    expect(po.brand).toBe('HUMAN BRAND') // human value preserved (never overwritten)
    expect(po.itemStyleNo).toBe('S1') // style was already filled on the first commit → not re-touched
  })
})

describe('CommitterService — co-valid customer parties (integration)', () => {
  // resolution facts + customers are seeded per test (resetDb wipes every table between tests)
  async function seedAEGroup(extraCustomers: { code: string; name: string }[] = []) {
    await db.deleteFrom('masterResolution').execute()
    await db
      .insertInto('customers')
      .values([
        { code: 'AEOW', name: 'AEO MANAGEMENT CO.' },
        { code: 'BLUI', name: 'BLUE STAR IMPORTS L.P.' },
        ...extraCustomers,
      ])
      .execute()
    await db
      .insertInto('masterResolution')
      .values([
        { kind: 'customer_group', lhs: 'AEOW', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
        { kind: 'customer_group', lhs: 'BLUI', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
        { kind: 'customer_role', lhs: 'AEOW', rhs: 'bill_to', status: 'approved', source: 'seed' },
        { kind: 'customer_role', lhs: 'BLUI', rhs: 'importer_of_record', status: 'approved', source: 'seed' },
      ])
      .execute()
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
    const parties = await db.selectFrom('shipmentParties').where('shipmentId', '=', res.shipmentId).selectAll().execute()
    expect(parties.map((p) => p.customerCode).sort()).toEqual(['AEOW', 'BLUI']) // FENIX dropped (no shared group)
    expect(parties.find((p) => p.customerCode === 'AEOW')?.isPrimary).toBe(true)
    expect(parties.find((p) => p.customerCode === 'BLUI')?.isPrimary).toBe(false)
    // booking.customer_id = the bill_to primary (AEOW), never the IOR
    const bk = await db.selectFrom('bookings').where('id', '=', res.bookingId).selectAll().executeTakeFirstOrThrow()
    const aeow = await db.selectFrom('customers').where('code', '=', 'AEOW').selectAll().executeTakeFirstOrThrow()
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
    const parties = await db.selectFrom('shipmentParties').where('shipmentId', '=', a.shipmentId).selectAll().execute()
    expect(parties).toHaveLength(2)
  })

  it('folds an alias (COLEB→COLE) onto booking.customer_id via canonical resolution', async () => {
    await db.deleteFrom('masterResolution').execute()
    await db.insertInto('customers').values([{ code: 'COLE', name: 'COLE BUXTON LTD' }]).execute()
    await db
      .insertInto('masterResolution')
      .values([{ kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', status: 'approved', source: 'seed' }])
      .execute()
    const res = await committer.apply(group({ fields: { customer_code: 'COLEB', so_no: 'SO-COLE' }, matchKeys: { so_no: 'SO-COLE' } }))
    const bk = await db.selectFrom('bookings').where('id', '=', res.bookingId).selectAll().executeTakeFirstOrThrow()
    const cole = await db.selectFrom('customers').where('code', '=', 'COLE').selectAll().executeTakeFirstOrThrow()
    expect(bk.customerId).toBe(cole.id) // COLEB resolved to COLE's id
  })

  it('writes no parties when the decision carries none (legacy/single-customer)', async () => {
    await db.deleteFrom('masterResolution').execute()
    await db.insertInto('customers').values([{ code: 'DOCC', name: 'DOCLASSE' }]).execute()
    const res = await committer.apply(group({ fields: { customer_code: 'DOCC', so_no: 'SO-SINGLE' }, matchKeys: { so_no: 'SO-SINGLE' } }))
    const parties = await db.selectFrom('shipmentParties').where('shipmentId', '=', res.shipmentId).selectAll().execute()
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
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.reviewStatus).toBe('provisional')
    expect(hasCargoFlag(leg)).toBe(true)
  })

  it('a leg WITH cargo numbers is NOT flagged for missing cargo', async () => {
    const res = await committer.apply(group({
      matchKeys: { booking_no: 'BKCARGO2' },
      pos: ['PO-CARGO2'],
      fields: { booking_no: 'BKCARGO2', qty: 100, qty_unit: 'cartons' },
    }))
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(hasCargoFlag(leg)).toBe(false)
  })

  it('a nascent booking with NO cargo unit at all is NOT flagged (avoids over-flagging normal early bookings)', async () => {
    const res = await committer.apply(group({
      matchKeys: { booking_no: 'BKCARGO3' },
      pos: ['PO-CARGO3'],
      fields: { booking_no: 'BKCARGO3' },
    }))
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(hasCargoFlag(leg)).toBe(false)
  })
})

describe('CommitterService — CVP notification-platform legs → DOCUMENT (integration)', () => {
  /** Seed an email_message (the source email) with a graph id + sender, so the committer can
   *  resolve whether the leg was built entirely from the notification platform on the agent path. */
  async function seedEmail(graphMessageId: string, sender: string) {
    await db
      .insertInto('emailMessage')
      .values({ graphMessageId, sender, receivedAt: new Date('2026-07-01T08:22:00Z') })
      .execute()
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

  it("agent path: CVP platform-only leg is SHIPMENT + provisional (no silent DOCUMENT demotion)", async () => {
    await seedEmail('cvp-1', 'notify.noreply2@tradelinkone.com')
    const res = await committer.apply(cvpGroup()) // fromPlatform unset → committer resolves it from the sender
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional')
    const reasons = Array.isArray(leg.reviewReasons) ? (leg.reviewReasons as string[]) : []
    expect(reasons.some((r) => /platform|portal|LPO/i.test(r))).toBe(true)
  })

  it('the SAME leg from a real forwarder sender stays kind=SHIPMENT (booking# is a booked move)', async () => {
    await seedEmail('cvp-1', 'ops@realforwarder.com')
    const res = await committer.apply(cvpGroup())
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
  })

  it('a platform leg that also carries a real MBL stays kind=SHIPMENT (a booked move the notice reports)', async () => {
    await seedEmail('cvp-1', 'notify.noreply2@tradelinkone.com')
    const res = await committer.apply(cvpGroup({ fields: { booking_no: 'FENLPO003034A', mbl: 'WHLC12345' } }))
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
  })

  it('rebuild path: fromPlatform=true flags provisional SHIPMENT without demoting to DOCUMENT', async () => {
    const res = await committer.apply(cvpGroup({ fromPlatform: true, events: [{ emailType: 'Other', receivedAt: '2026-07-01T08:22:00Z' }] }))
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional')
  })
})

describe('CommitterService — de-correction (b): PO-enrichment surfaced as review flags (integration)', () => {
  /** One email_message + N parsed_records sharing its messageId (broadcast detection groups by messageId). */
  async function seedEmail(graphMessageId: string, receivedAt: string, records: { poNo: string | null; fields: Record<string, unknown>; matchKeys?: Record<string, unknown> }[]) {
    const msg = await db
      .insertInto('emailMessage')
      .values({ graphMessageId, receivedAt: new Date(receivedAt) })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('parsedRecord')
      .values(
        records.map((r, i) => {
          const mk = r.matchKeys ?? {}
          const poNoNorm =
            String(r.poNo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') ||
            String(mk.customer_po ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') ||
            null
          return {
            messageId: msg.id,
            graphMessageId, // as production ingest writes it (NULL gmids collide on the SQL Server unique key)
            recordIdx: i,
            poNo: r.poNo,
            poNoNorm,
            fields: JSON.stringify(r.fields),
            matchKeys: JSON.stringify(mk),
          }
        }),
      )
      .execute()
  }
  const legFor = (id: string) => db.selectFrom('shipments').where('id', '=', id).selectAll().executeTakeFirstOrThrow()
  const reasons = (leg: { reviewReasons?: string[] | null }) => leg.reviewReasons ?? []

  it('b1: a suspected broadcast total is KEPT on the PO and is NOT review-flagged (UI shows shipment total once)', async () => {
    await seedEmail('bcast', '2026-06-30T05:00:00Z', [
      { poNo: 'PO-BA', fields: { qty: '168', qty_unit: 'cartons' } },
      { poNo: 'PO-BB', fields: { qty: '168', qty_unit: 'cartons' } },
      { poNo: 'PO-BC', fields: { qty: '168', qty_unit: 'cartons' } },
    ])
    const res = await committer.apply(group({ pos: ['PO-BA', 'PO-BB', 'PO-BC'], matchKeys: { so_no: 'SO-BCAST' } }))
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', 'PO-BA').selectAll().executeTakeFirstOrThrow()
    expect(po.totalQuantity).toBe(168) // KEPT (raw model value), not nulled
    const leg = await legFor(res.shipmentId)
    expect(reasons(leg).some((r) => /broadcast total/i.test(r))).toBe(false)
  })

  it('b2: a per-PO brand conflict keeps the newest value and flags the leg', async () => {
    await seedEmail('m-old', '2026-06-01T00:00:00Z', [{ poNo: 'PO-CONF', fields: { brand: 'Barbour' } }])
    await seedEmail('m-new', '2026-06-02T00:00:00Z', [{ poNo: 'PO-CONF', fields: { brand: 'FENIX' } }])
    const res = await committer.apply(group({ pos: ['PO-CONF'], matchKeys: { so_no: 'SO-CONF' } }))
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', 'PO-CONF').selectAll().executeTakeFirstOrThrow()
    expect(po.brand).toBe('FENIX') // newest still wins (written value unchanged)
    const leg = await legFor(res.shipmentId)
    expect(leg.reviewStatus).toBe('provisional')
    expect(reasons(leg).some((r) => /brand conflict/i.test(r))).toBe(true)
  })

  it('b2 no-PO: a brand stated with no PO is NOT leaked onto the PO but IS flagged (not silently dropped)', async () => {
    await seedEmail('m-so', '2026-06-30T05:00:00Z', [{ poNo: null, matchKeys: { so_no: 'SO-UNATTR' }, fields: { brand: 'Barbour' } }])
    await seedEmail('m-po', '2026-06-30T05:01:00Z', [{ poNo: 'PO-UNATTR', matchKeys: { customer_po: 'PO-UNATTR', so_no: 'SO-UNATTR' }, fields: { item_style_no: 'ABC' } }])
    const res = await committer.apply(group({ pos: ['PO-UNATTR'], matchKeys: { so_no: 'SO-UNATTR' } }))
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', 'PO-UNATTR').selectAll().executeTakeFirstOrThrow()
    expect(po.brand).toBeNull() // never leaked onto the PO
    const leg = await legFor(res.shipmentId)
    expect(reasons(leg).some((r) => /not attributed to any PO/i.test(r))).toBe(true)
  })
})

describe('CommitterService — de-correction STEP 2/3: no silent guards / no shadows', () => {
  const reasonsOf = (leg: { reviewReasons: unknown }) =>
    Array.isArray(leg.reviewReasons) ? (leg.reviewReasons as string[]) : []

  it('platform forwarder keeps raw name, does not link, routes provisional review', async () => {
    const res = await committer.apply(
      group({
        pos: [],
        fields: { forwarder_name: 'TradeLinkOne', so_no: 'SO-SCRUB' },
        matchKeys: { so_no: 'SO-SCRUB' },
      }),
    )
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    // raw kept for display (no silent scrub-to-null)
    expect(String(leg.forwarderRaw ?? '').toLowerCase()).toContain('tradelink')
    expect(leg.forwarderId).toBeNull()
    expect(leg.reviewStatus).toBe('provisional')
    expect(reasonsOf(leg).some((r) => /platform/i.test(r))).toBe(true)
    const shadows = await db
      .selectFrom('changeLog')
      .where('entityId', '=', res.shipmentId)
      .where('changeType', '=', 'shadow')
      .selectAll()
      .execute()
    expect(shadows).toHaveLength(0)
  })

  it('platform-only portal booking stays SHIPMENT with review flag (no DOCUMENT demotion)', async () => {
    const res = await committer.apply(
      group({
        pos: [],
        fields: { booking_no: 'FENLPOSHADOW1' },
        matchKeys: { booking_no: 'FENLPOSHADOW1' },
        emailTypes: ['Other'],
        events: [{ emailType: 'Other', receivedAt: '2026-01-01T00:00:00Z' }],
        fromPlatform: true,
      }),
    )
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional')
    expect(reasonsOf(leg).some((r) => /platform|portal|LPO/i.test(r))).toBe(true)
  })

  it('bare orphan stays SHIPMENT (Documents = Invoice/Billing only)', async () => {
    const res = await committer.apply(
      group({
        pos: [],
        fields: {},
        matchKeys: {},
        emailTypes: ['Other'],
        events: [{ emailType: 'Other', receivedAt: '2026-01-01T00:00:00Z' }],
      }),
    )
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional')
  })

  it('Invoice/Billing-only without booking_no is DOCUMENT (Unlinked Documents)', async () => {
    const res = await committer.apply(
      group({
        pos: [],
        fields: { so_no: 'CMS-INV-1' },
        matchKeys: { so_no: 'CMS-INV-1' },
        emailTypes: ['Invoice/Billing'],
        events: [{ emailType: 'Invoice/Billing', receivedAt: '2026-01-01T00:00:00Z' }],
      }),
    )
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('DOCUMENT')
  })

  it('Invoice/Billing-only WITH booking_no is SHIPMENT + provisional (not parked as DOCUMENT)', async () => {
    const res = await committer.apply(
      group({
        pos: [],
        fields: { booking_no: 'BX-INV-BOOK-1' },
        matchKeys: { booking_no: 'BX-INV-BOOK-1' },
        emailTypes: ['Invoice/Billing'],
        events: [{ emailType: 'Invoice/Billing', receivedAt: '2026-01-01T00:00:00Z' }],
      }),
    )
    const leg = await db.selectFrom('shipments').where('id', '=', res.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional')
    expect(reasonsOf(leg).some((r) => /Invoice\/Billing.*booking|booking number is present/i.test(r))).toBe(true)
  })
})

describe('resolution exact-only (all-AI: fuzzy deleted, LLM owns free-text)', () => {
  const reasonsOf = (leg: { reviewReasons: unknown }) =>
    Array.isArray(leg.reviewReasons) ? (leg.reviewReasons as string[]) : []

  it('substring forwarder name does NOT link; code_exact does; free-text → provisional', async () => {
    const fwd = await db
      .insertInto('forwarders')
      .values({ code: 'EXPKRA', name: 'EXPEDITORS KOREA LTD' })
      .output('inserted.id')
      .executeTakeFirstOrThrow()

    // containment deleted: partial name no longer links
    const a = await committer.apply(
      group({
        pos: [],
        fields: { forwarder_name: 'EXPEDITORS KOREA', so_no: 'SO-FWD-A' },
        matchKeys: { so_no: 'SO-FWD-A' },
      }),
    )
    const legA = await db.selectFrom('shipments').where('id', '=', a.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(legA.forwarderId).toBeNull()
    expect(legA.reviewStatus).toBe('provisional')
    expect(reasonsOf(legA).some((r) => /exact-match|LLM matcher/i.test(r))).toBe(true)

    // code_exact still links
    const b = await committer.apply(
      group({
        pos: [],
        fields: { forwarder_name: 'EXPKRA', so_no: 'SO-FWD-B' },
        matchKeys: { so_no: 'SO-FWD-B' },
      }),
    )
    const legB = await db.selectFrom('shipments').where('id', '=', b.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(legB.forwarderId).toBe(fwd.id)
  })

  it('curated port abbreviation still links; free-text city without fact does not; UN/LOCODE does', async () => {
    await db
      .insertInto('ports')
      .values([
        { unlocode: 'VNSGN', name: 'Ho Chi Minh City', country: 'VN', mode: 'both' },
        { unlocode: 'CNSHK', name: 'Shekou', country: 'CN', mode: 'sea' },
      ])
      .execute()
    await db
      .insertInto('masterResolution')
      .values([{ kind: 'port_abbreviation', lhs: 'HCM', rhs: 'VNSGN', status: 'approved', source: 'seed', reason: null }] as never)
      .execute()

    const a = await committer.apply(
      group({
        pos: [],
        fields: { pol: 'HCM', so_no: 'SO-PORT-A' },
        matchKeys: { so_no: 'SO-PORT-A' },
      }),
    )
    const legA = await db.selectFrom('shipments').where('id', '=', a.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(legA.polId).not.toBeNull()

    // fuzzy city name deleted — no free-text "Shekou" link without curated fact / UNLOCODE
    const c = await committer.apply(
      group({
        pos: [],
        fields: { pol: 'Shekou Port Terminal', so_no: 'SO-PORT-C' },
        matchKeys: { so_no: 'SO-PORT-C' },
      }),
    )
    const legC = await db.selectFrom('shipments').where('id', '=', c.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(legC.polId).toBeNull()
    expect(legC.reviewStatus).toBe('provisional')

    const b = await committer.apply(
      group({
        pos: [],
        fields: { pol: 'CNSHK', so_no: 'SO-PORT-B' },
        matchKeys: { so_no: 'SO-PORT-B' },
      }),
    )
    const legB = await db.selectFrom('shipments').where('id', '=', b.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(legB.polId).not.toBeNull()
  })
})

/**
 * 0027 — the committer records what it DID, on every path.
 *
 * Before this, a matched leg was stamped (`committerChosenLegId`) and a CREATED leg was recorded by
 * the absence of that stamp. Absence-as-signal is what let a review-desk rule mistake a leg the email
 * had just created for one the email merely named — opposite situations, identical in the data.
 */
describe('CommitterService — committer_action (0027)', () => {
  const legOf = async (id: string) =>
    db.selectFrom('shipments').where('id', '=', id).selectAll().executeTakeFirstOrThrow()

  it('a fresh group records created, with no candidates to weigh it against', async () => {
    const res = await committer.apply(group({ fields: { so_no: 'SO-C1' }, matchKeys: { so_no: 'SO-C1' } }))
    const leg = await legOf(res.shipmentId)
    expect(leg.committerAction).toBe('created')
    expect(leg.committerCandidatesConsidered).toBeNull()
  })

  /** The state that did not exist before: committed, but the matcher had alternatives on the table. */
  it('created WHILE the matcher offered candidates records created_pending_dedup + the count', async () => {
    const res = await committer.apply(
      group({
        fields: { so_no: 'SO-C2' },
        matchKeys: { so_no: 'SO-C2' },
        criticReview: {
          matchAmbiguity: {
            kind: 'multi_candidate',
            candidates: [{ shipmentId: 'x1' }, { shipmentId: 'x2' }, { shipmentId: 'x3' }],
          },
        },
      } as Partial<ReconGroup>),
    )
    const leg = await legOf(res.shipmentId)
    expect(leg.committerAction).toBe('created_pending_dedup')
    expect(leg.committerCandidatesConsidered).toBe(3)
  })

  it('the same group again amends the SAME leg and records matched', async () => {
    const first = await committer.apply(group({ fields: { so_no: 'SO-C3' }, matchKeys: { so_no: 'SO-C3' } }))
    expect((await legOf(first.shipmentId)).committerAction).toBe('created')

    const second = await committer.apply(
      group({ fields: { so_no: 'SO-C3', vessel_name: 'EVER GIVEN' }, matchKeys: { so_no: 'SO-C3' } }),
    )
    expect(second.shipmentId).toBe(first.shipmentId)
    const leg = await legOf(second.shipmentId)
    expect(leg.committerAction).toBe('matched')
    expect(leg.committerTargetLegId).toBe(first.shipmentId)
  })

  it('a single candidate is not a dedup question — that is just created', async () => {
    const res = await committer.apply(
      group({
        fields: { so_no: 'SO-C4' },
        matchKeys: { so_no: 'SO-C4' },
        criticReview: { matchAmbiguity: { kind: 'multi_candidate', candidates: [{ shipmentId: 'x1' }] } },
      } as Partial<ReconGroup>),
    )
    const leg = await legOf(res.shipmentId)
    expect(leg.committerAction).toBe('created')
    expect(leg.committerCandidatesConsidered).toBe(1)
  })
})

/**
 * Phase 2 — the per-field outcome applyFields always computed and discarded.
 *
 * "The leg already held this" and "a human's value stood in the way" are very different stories, and
 * the desk had to guess between them after the fact.
 */
describe('CommitterService — per-field apply outcome', () => {
  it('separates written, already-identical and contested', async () => {
    const first = await committer.apply(
      group({
        fields: { so_no: 'SO-F1', vessel_name: 'MARIBO MAERSK', voyage_no: '631W' },
        matchKeys: { so_no: 'SO-F1' },
      }),
    )
    // A create writes everything, so there is nothing to report.
    expect(first.fieldOutcome).toBeNull()

    const second = await committer.apply(
      group({
        fields: { so_no: 'SO-F1', vessel_name: 'MARIBO MAERSK', voyage_no: '999X' },
        matchKeys: { so_no: 'SO-F1' },
      }),
    )
    expect(second.shipmentId).toBe(first.shipmentId)
    const out = second.fieldOutcome!
    // vessel unchanged → alreadySame; voyage changed → applied.
    expect(out.alreadySame).toContain('vesselName')
    expect(out.applied).toContain('voyageNo')
    expect(out.applied).not.toContain('vesselName')
    expect(out.contested).toEqual([])
  })

  it('a write over a human lock is reported as contested, not merely applied', async () => {
    const first = await committer.apply(
      group({ fields: { so_no: 'SO-F2', vessel_name: 'MARIBO MAERSK' }, matchKeys: { so_no: 'SO-F2' } }),
    )
    await db
      .insertInto('fieldLocks')
      .values({ entityType: 'shipment', entityId: first.shipmentId, field: 'vesselName', lockedValue: 'MARIBO MAERSK' })
      .execute()

    const second = await committer.apply(
      group({ fields: { so_no: 'SO-F2', vessel_name: 'EVER GIVEN' }, matchKeys: { so_no: 'SO-F2' } }),
    )
    const out = second.fieldOutcome!
    expect(out.applied).toContain('vesselName')
    expect(out.contested).toContain('vesselName')
    // The existing supersede signal keeps working — this is additive.
    expect(second.supersededLockedFields).toContain('vesselName')
  })
})

/**
 * The stale master-FK class, third path — the one the two human write paths were cured of in July and
 * the committer was not.
 *
 * The committer writes the raw party twin on the LEG (`vendor_raw` / `customer_raw`), but the
 * customer/vendor master hangs off the BOOKING, and `fillBooking` is first-writer-wins: it only fills
 * a column that is still null. So once a booking had a vendor, a later email naming a different
 * factory wrote the raw twin and could never move the link — and display, which prefers the master,
 * kept showing a company the leg no longer named.
 *
 * Leg 20260405F1 was the live example: `vendor_raw = ELSMCO` under `booking.vendor_id = SOUOCE`, so
 * Order Details printed SOUOCE while the review desk's Current read ELSMCO, and no click available to
 * an operator could reconcile them.
 */
describe('CommitterService — the party master follows the raw twin (stale-FK, third path)', () => {
  async function seedVendors() {
    await db
      .insertInto('vendors')
      .values([
        { code: 'MACFUN', name: 'MACAU FUNG TAI LIMITED' },
        { code: 'ELSMCO', name: 'ELEGANT SMART CORPORATION LIMITED' },
      ])
      .execute()
  }
  const vendorIdOf = async (code: string) =>
    (await db.selectFrom('vendors').where('code', '=', code).selectAll().executeTakeFirstOrThrow()).id
  const bookingVendor = async (bookingId: string) =>
    (await db.selectFrom('bookings').where('id', '=', bookingId).selectAll().executeTakeFirstOrThrow())
      .vendorId
  const legOf = async (shipmentId: string) =>
    db.selectFrom('shipments').where('id', '=', shipmentId).selectAll().executeTakeFirstOrThrow()

  it('amend: a later email naming a different factory re-points the booking FK', async () => {
    await seedVendors()
    const first = await committer.apply(
      group({ fields: { so_no: 'SO-V1', vendor_code: 'MACFUN' }, matchKeys: { so_no: 'SO-V1' } }),
    )
    expect(await bookingVendor(first.bookingId)).toBe(await vendorIdOf('MACFUN'))

    const second = await committer.apply(
      group({ fields: { so_no: 'SO-V1', vendor_code: 'ELSMCO' }, matchKeys: { so_no: 'SO-V1' } }),
    )
    expect(second.action).toBe('amend_fields')
    // fillBooking alone would have left MACFUN linked — this is the assertion the bug failed.
    expect(await bookingVendor(second.bookingId)).toBe(await vendorIdOf('ELSMCO'))
    expect((await legOf(second.shipmentId)).vendorRaw).toBe('ELSMCO')
  })

  /**
   * De-correction: the committer never edits what the agent read. Only the LINK that display follows
   * is kept honest.
   */
  it('leaves the raw value exactly as the email stated it', async () => {
    await seedVendors()
    const res = await committer.apply(
      group({
        fields: { so_no: 'SO-V2', vendor_code: 'ELEGANT SMART CORPORATION LIMITED' },
        matchKeys: { so_no: 'SO-V2' },
      }),
    )
    const leg = await legOf(res.shipmentId)
    expect(leg.vendorRaw).toBe('ELEGANT SMART CORPORATION LIMITED')
    // resolveVendor matches on CODE only, so the create path could not link a full name…
    // …but the re-resolve matches name too, so the booking still ends up correctly linked.
    expect(await bookingVendor(res.bookingId)).toBe(await vendorIdOf('ELSMCO'))
  })

  /**
   * The regression this rule exists to prevent. `resolveAll` folds aliases and canonical customer
   * facts (COLEB → COLE) that `customerIdExact` cannot see, so "no exact match" is NOT evidence that
   * the existing link is wrong — unlinking on it destroyed correct alias links and broke the
   * co-valid-parties test above. The two human paths may unlink; a person typed the value and meant
   * it. The committer only ever re-points.
   */
  it('amend: never UNLINKS when the new raw matches no master', async () => {
    await seedVendors()
    // Applied for the LEG it creates, not for what it returns — the assertions all read `second`.
    await committer.apply(
      group({ fields: { so_no: 'SO-V3', vendor_code: 'MACFUN' }, matchKeys: { so_no: 'SO-V3' } }),
    )
    const second = await committer.apply(
      group({
        fields: { so_no: 'SO-V3', vendor_code: 'BRAND NEW KNITTERS LTD' },
        matchKeys: { so_no: 'SO-V3' },
      }),
    )
    expect(await bookingVendor(second.bookingId)).toBe(await vendorIdOf('MACFUN'))
    // the raw still records what the email said — the desk surfaces the divergence as a question
    expect((await legOf(second.shipmentId)).vendorRaw).toBe('BRAND NEW KNITTERS LTD')
  })

  it('writes nothing — and audits nothing — when the link already agrees', async () => {
    await seedVendors()
    const g = group({ fields: { so_no: 'SO-V4', vendor_code: 'MACFUN' }, matchKeys: { so_no: 'SO-V4' } })
    const first = await committer.apply(g)
    await committer.apply(g)
    await committer.apply(g)
    expect(await bookingVendor(first.bookingId)).toBe(await vendorIdOf('MACFUN'))
    // else every commit on a settled leg would append an identical vendorId row to the audit trail
    const vendorAudits = await db
      .selectFrom('changeLog')
      .where('entityId', '=', first.shipmentId)
      .where('field', '=', 'vendorId')
      .selectAll()
      .execute()
    expect(vendorAudits).toHaveLength(0)
  })

  it('records the move in the audit trail when it does re-point', async () => {
    await seedVendors()
    const first = await committer.apply(
      group({ fields: { so_no: 'SO-V5', vendor_code: 'MACFUN' }, matchKeys: { so_no: 'SO-V5' } }),
    )
    await committer.apply(
      group({ fields: { so_no: 'SO-V5', vendor_code: 'ELSMCO' }, matchKeys: { so_no: 'SO-V5' } }),
    )
    const rows = await db
      .selectFrom('changeLog')
      .where('entityId', '=', first.shipmentId)
      .where('field', '=', 'vendorId')
      .selectAll()
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.oldValue).toBe(await vendorIdOf('MACFUN'))
    expect(rows[0]!.newValue).toBe(await vendorIdOf('ELSMCO'))
  })

  it('create: a fresh booking is linked from its own raw value', async () => {
    await seedVendors()
    const res = await committer.apply(
      group({ fields: { so_no: 'SO-V6', vendor_code: 'ELSMCO' }, matchKeys: { so_no: 'SO-V6' } }),
    )
    expect(res.action).toBe('create_booking')
    expect(await bookingVendor(res.bookingId)).toBe(await vendorIdOf('ELSMCO'))
  })

  it('a leg that names no vendor leaves the existing link alone', async () => {
    await seedVendors()
    // Applied for the LEG it creates, not for what it returns — the assertions all read `second`.
    await committer.apply(
      group({ fields: { so_no: 'SO-V7', vendor_code: 'MACFUN' }, matchKeys: { so_no: 'SO-V7' } }),
    )
    // a later email about the same shipment that simply does not mention the factory
    const second = await committer.apply(
      group({ fields: { so_no: 'SO-V7', vessel_name: 'MARIBO MAERSK' }, matchKeys: { so_no: 'SO-V7' } }),
    )
    expect(await bookingVendor(second.bookingId)).toBe(await vendorIdOf('MACFUN'))
  })
})
