import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService } from '../src/reconcile/committer.service'
import { DecisionsService } from '../src/decisions/decisions.service'
import { SettingsService } from '../src/settings/settings.service'
import type { CreateDecisionDto } from '../src/decisions/dto'

let db: TestDB
let decisions: DecisionsService
let settings: SettingsService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit)
  settings = new SettingsService(r.settings)
  decisions = new DecisionsService(committer, settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

/** A scored decision as the Agent VM would POST it (Matcher merged, Critic scored). */
const decision = (over: Partial<CreateDecisionDto> = {}): CreateDecisionDto => ({
  matchKey: { so_no: 'SO-1', customer_po: 'PO-X' },
  fields: { so_no: 'SO-1', booking_no: 'BK-1', etd: '2026-02-10' },
  pos: ['PO-X'],
  mode: 'Sea-LCL',
  emailTypes: ['SO'],
  events: [{ emailType: 'SO', receivedAt: '2026-02-01T00:00:00Z', graphId: 'g-so-1' }],
  conflicts: [],
  confidence: 90,
  evidenceRefs: [{ graphMessageId: 'g-so-1', emailType: 'SO' }],
  conversationId: 'thread-1',
  ...over,
})

describe('DecisionsService (integration)', () => {
  it('commits a high-confidence decision as confirmed (commit-first)', async () => {
    const res = await decisions.ingest(decision({ confidence: 92 }))
    expect(res.action).toBe('create_booking')
    expect(res.reviewStatus).toBe('confirmed')

    const legs = await db.select().from(schema.shipments)
    expect(legs).toHaveLength(1)
    expect(legs[0].reviewStatus).toBe('confirmed')
    expect(legs[0].confidence).toBe(92)
    expect(legs[0].soNo).toBe('SO-1')
  })

  it('routes a low-confidence decision to provisional', async () => {
    const res = await decisions.ingest(decision({ confidence: 50 }))
    expect(res.reviewStatus).toBe('provisional')
    const [leg] = await db.select().from(schema.shipments)
    expect(leg.reviewStatus).toBe('provisional')
    expect(leg.confidence).toBe(50)
  })

  it('uses the configurable threshold from settings (raw score in, routing on tracking)', async () => {
    await settings.setConfidenceThreshold(40)
    const res = await decisions.ingest(decision({ confidence: 50 }))
    expect(res.reviewStatus).toBe('confirmed') // 50 >= 40
  })

  it('the agent review gate VETOES an auto-confirm the score alone would allow (autoApply:false → provisional)', async () => {
    const res = await decisions.ingest(decision({ confidence: 92, autoApply: false, reviewReasons: ['backend leg matched on PO only'] }))
    expect(res.reviewStatus).toBe('provisional') // high score, but the deterministic gate withheld it
    const [leg] = await db.select().from(schema.shipments)
    expect(leg.reviewStatus).toBe('provisional')
    expect(leg.reviewReasons).toEqual(['backend leg matched on PO only']) // gate reasons surface ahead of conflicts
  })

  it('autoApply:true still routes on the score (gate never FORCES a confirm)', async () => {
    expect((await decisions.ingest(decision({ confidence: 92, autoApply: true }))).reviewStatus).toBe('confirmed')
  })

  it('autoApply:true with a low score stays provisional (both gates must pass)', async () => {
    expect((await decisions.ingest(decision({ confidence: 50, autoApply: true }))).reviewStatus).toBe('provisional')
  })

  it('autoApply omitted (legacy caller) routes on confidence alone — unchanged', async () => {
    expect((await decisions.ingest(decision({ confidence: 92 }))).reviewStatus).toBe('confirmed')
  })

  it('upserts the same shipment by match-key (idempotent across emails)', async () => {
    await decisions.ingest(decision({ confidence: 90 }))
    await decisions.ingest(
      decision({
        confidence: 90,
        fields: { so_no: 'SO-1', hbl_awb_fcr_no: 'HBL-9' },
        emailTypes: ['Final B/L'],
        events: [{ emailType: 'Final B/L', receivedAt: '2026-02-05T00:00:00Z', graphId: 'g-bl-1' }],
      }),
    )
    const legs = await db.select().from(schema.shipments)
    expect(legs).toHaveLength(1) // matched on so_no + PO, not duplicated
    expect(legs[0].hblAwbFcrNo).toBe('HBL-9')
  })

  it('never overwrites a human-locked field', async () => {
    const first = await decisions.ingest(decision({ confidence: 90 }))
    await db.update(schema.shipments).set({ bookingNo: 'BK-LOCKED' }).where(eq(schema.shipments.id, first.shipmentId))
    await db
      .insert(schema.fieldLocks)
      .values({ entityType: 'shipment', entityId: first.shipmentId, field: 'bookingNo', lockedValue: 'BK-LOCKED' })

    const res = await decisions.ingest(decision({ confidence: 90, fields: { so_no: 'SO-1', booking_no: 'BK-NEW' } }))
    expect(res.skippedLockedFields).toContain('bookingNo')
    const [leg] = await db.select().from(schema.shipments)
    expect(leg.bookingNo).toBe('BK-LOCKED') // human edit survives the agent
  })

  it('stamps the milestone with the source graph id (for view-original)', async () => {
    const res = await decisions.ingest(decision({ confidence: 90 }))
    const ms = await db
      .select()
      .from(schema.shipmentMilestones)
      .where(eq(schema.shipmentMilestones.shipmentId, res.shipmentId))
    const so = ms.find((m) => m.milestoneType === 'SO_RECEIVED')
    expect(so?.emailMessageId).toBe('g-so-1')
  })
})
