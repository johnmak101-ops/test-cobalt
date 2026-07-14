import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
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
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder)
  settings = new SettingsService(r.settings)
  decisions = new DecisionsService(committer, settings, r.ingest)
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

    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(1)
    expect(legs[0].reviewStatus).toBe('confirmed')
    expect(legs[0].confidence).toBe(92)
    expect(legs[0].soNo).toBe('SO-1')
  })

  it('routes a low-confidence decision to provisional', async () => {
    const res = await decisions.ingest(decision({ confidence: 50 }))
    expect(res.reviewStatus).toBe('provisional')
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
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
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
    expect(leg.reviewStatus).toBe('provisional')
    expect(leg.reviewReasons).toEqual(['backend leg matched on PO only']) // gate reasons surface ahead of conflicts
  })

  it('autoApply:true CONFIRMS (the deterministic gate is authoritative)', async () => {
    expect((await decisions.ingest(decision({ confidence: 92, autoApply: true }))).reviewStatus).toBe('confirmed')
  })

  it('autoApply:true with a LOW score STILL confirms — an informational completeness score no longer vetoes the gate', async () => {
    expect((await decisions.ingest(decision({ confidence: 50, autoApply: true }))).reviewStatus).toBe('confirmed')
  })

  it('autoApply omitted (legacy caller) routes on confidence alone — unchanged', async () => {
    expect((await decisions.ingest(decision({ confidence: 92 }))).reviewStatus).toBe('confirmed')
  })

  it('cancelled=true always forces provisional with "Booking cancelled" first + leg_status CANCELLED', async () => {
    // High confidence + autoApply would otherwise confirm — cancel must still await review.
    const res = await decisions.ingest(
      decision({ confidence: 95, autoApply: true, cancelled: true }),
    )
    expect(res.reviewStatus).toBe('provisional')
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
    expect(leg.reviewStatus).toBe('provisional')
    expect(leg.legStatus).toBe('CANCELLED')
    const reasons = Array.isArray(leg.reviewReasons) ? (leg.reviewReasons as string[]) : []
    expect(reasons[0]).toBe('Booking cancelled')
  })

  it('cancelled=true puts "Booking cancelled" first even when other reasons exist', async () => {
    const res = await decisions.ingest(
      decision({
        confidence: 50,
        autoApply: false,
        cancelled: true,
        reviewReasons: ['backend conflict on qty'],
      }),
    )
    expect(res.reviewStatus).toBe('provisional')
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
    const reasons = Array.isArray(leg.reviewReasons) ? (leg.reviewReasons as string[]) : []
    expect(reasons[0]).toBe('Booking cancelled')
    expect(reasons).toContain('backend conflict on qty')
  })

  it('a skip disposition (不需處理) is acknowledged but commits NOTHING — no phantom tracker leg, idempotent on re-POST', async () => {
    const res = await decisions.ingest(
      decision({ confidence: 92, autoApply: false, disposition: 'skip', reviewReasons: ['no PO / strong id / shipment data — not actionable (不需處理)'] }),
    )
    expect(res.reviewStatus).toBe('skip')
    expect(res.action).toBe('skip')
    // a skip is not a shipment: NO leg (so it never appears in legsForTracker/activeLegs) and NO booking
    // (so it never burns a JOB-XXXX number) — even at a high confidence that would otherwise auto-confirm.
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(0)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(0)
    // re-POSTing the same notification stays a no-op (no duplicate contentless legs)
    await decisions.ingest(decision({ confidence: 92, disposition: 'skip' }))
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(0)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(0)
  })

  it('a PO-only decision is idempotent BY PO — a re-POST amends, never a duplicate leg', async () => {
    const po = (eta: string) => decision({ matchKey: { customer_po: 'PO-DUP' }, pos: ['PO-DUP'], fields: { customer_po: 'PO-DUP', eta } })
    await decisions.ingest(po('2026-03-01'))
    await decisions.ingest(po('2026-04-01')) // re-send / follow-up of the same PO-only email
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1) // NOT two phantom legs
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('a PO-only leg is UPGRADED (not duplicated) when its first strong id arrives sharing the PO', async () => {
    await decisions.ingest(decision({ matchKey: { customer_po: 'PO-UP' }, pos: ['PO-UP'], fields: { customer_po: 'PO-UP' } }))
    await decisions.ingest(decision({ matchKey: { booking_no: 'BK-UP', customer_po: 'PO-UP' }, pos: ['PO-UP'], fields: { booking_no: 'BK-UP', customer_po: 'PO-UP' } }))
    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(1) // the nascent PO-only leg gained BK-UP — not a second shipment
    expect(legs[0].bookingNo).toBe('BK-UP')
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
    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(1) // matched on so_no + PO, not duplicated
    expect(legs[0].hblAwbFcrNo).toBe('HBL-9')
  })

  it('never overwrites a human-locked field', async () => {
    const first = await decisions.ingest(decision({ confidence: 90 }))
    await db.updateTable('shipments').set({ bookingNo: 'BK-LOCKED' }).where('id', '=', first.shipmentId).execute()
    await db
      .insertInto('fieldLocks')
      .values({ entityType: 'shipment', entityId: first.shipmentId, field: 'bookingNo', lockedValue: 'BK-LOCKED' })
      .execute()

    const res = await decisions.ingest(decision({ confidence: 90, fields: { so_no: 'SO-1', booking_no: 'BK-NEW' } }))
    expect(res.skippedLockedFields).toContain('bookingNo')
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
    expect(leg.bookingNo).toBe('BK-LOCKED') // human edit survives the agent
  })

  it('stamps the milestone with the source graph id (for view-original)', async () => {
    const res = await decisions.ingest(decision({ confidence: 90 }))
    const ms = await db
      .selectFrom('shipmentMilestones')
      .where('shipmentId', '=', res.shipmentId)
      .selectAll()
      .execute()
    const so = ms.find((m) => m.milestoneType === 'SO_RECEIVED')
    expect(so?.emailMessageId).toBe('g-so-1')
  })

  it('persists criticReview JSON on the leg and round-trips', async () => {
    const criticReview = {
      confidence: { score: 38, band: 'low', label: 'Low' },
      summary: 'Two HBLs',
      observations: [],
      priorState: { headline: 'New', fields: [] },
      proposedChanges: [],
      riskFlags: [{ code: 'INTRA_EMAIL_MULTI_STRONG_ID', severity: 'high', message: 'multi' }],
      conflicts: [{
        field: 'hbl_awb_fcr_no', label: 'HBL',
        candidates: [{ value: 'H1', source: 'Final B/L' }, { value: 'H2', source: 'Draft B/L' }],
        rationale: 'Split or multi-leg',
      }],
      recommendedHumanAction: 'split_or_multi_leg',
      reasons: ['multi'],
    }
    const r = await decisions.ingest(decision({
      autoApply: false,
      disposition: 'review',
      confidence: 38,
      criticReview,
    }))
    const [leg] = await db.selectFrom('shipments').where('id', '=', r.shipmentId).selectAll().execute()
    expect(leg?.criticReview).toMatchObject({ confidence: { band: 'low' } })
    expect((leg?.criticReview as { conflicts: unknown[] }).conflicts).toHaveLength(1)
  })
})

describe('DecisionsService email disposition (integration)', () => {
  it('lookupContext modeChange forces review even when agent autoApply:true', async () => {
    const res = await decisions.ingest(
      decision({ autoApply: true, confidence: 99, lookupContext: { modeChange: true } }),
    )
    expect(res.reviewStatus).toBe('provisional')
  })

  it('derived skip when no PO/strong id/status (不需處理) commits nothing', async () => {
    const res = await decisions.ingest(
      decision({
        matchKey: {},
        pos: [],
        fields: { note: 'fyi' },
        autoApply: false,
        disposition: undefined,
        lookupContext: { statusUpdate: false },
      }),
    )
    expect(res.action).toBe('skip')
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(0)
  })
})
