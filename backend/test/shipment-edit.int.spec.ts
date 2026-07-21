import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ShipmentsService } from '../src/shipments/shipments.service'

let db: TestDB
let service: ShipmentsService
let actorId: string

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  const queueLearning = { postCorrection: async () => undefined } as never
  service = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit, null as never, queueLearning)
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const u = await db
    .insertInto('users')
    .values({ email: 'e@cobalt.hk', name: 'Editor', passwordHash: 'x', role: 'EDITOR' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  actorId = u.id
})

async function seedLeg() {
  const bk = await db.insertInto('bookings').values({ jobNo: 'JOB-E-1' }).outputAll('inserted').executeTakeFirstOrThrow()
  const leg = await db
    .insertInto('shipments')
    .values({ bookingId: bk.id, legNo: 1 })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  return leg
}

describe('ShipmentsService.editFields — the human note feeds agent-soul iteration', () => {
  it("writes the reviewer's note onto each edited field's audit row", async () => {
    const leg = await seedLeg()
    const res = await service.editFields(
      leg.id,
      { soNo: 'FIXED-SO' },
      actorId,
      'booking came off the SO line — use the CW# on the booking confirmation',
    )
    expect(res.edited).toContain('soNo')

    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    const soRow = audit.find((a) => a.field === 'soNo')
    expect(soRow?.note).toBe('booking came off the SO line — use the CW# on the booking confirmation')
    expect(soRow?.sourceType).toBe('manual')
    expect(soRow?.actorUserId).toBe(actorId)
  })

  it('falls back to the generic marker when no note is supplied (legacy callers)', async () => {
    const leg = await seedLeg()
    await service.editFields(leg.id, { soNo: 'X' }, actorId)
    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    expect(audit.find((a) => a.field === 'soNo')?.note).toBe('edited on shipment detail')
  })

  it('treats a whitespace-only note as no note (falls back)', async () => {
    const leg = await seedLeg()
    await service.editFields(leg.id, { soNo: 'Y' }, actorId, '   ')
    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    expect(audit.find((a) => a.field === 'soNo')?.note).toBe('edited on shipment detail')
  })

  it('accepts mode / polRaw / podRaw / forwarderRaw free-text (#183 detail edit)', async () => {
    const leg = await seedLeg()
    const res = await service.editFields(
      leg.id,
      { mode: 'AIR', polRaw: 'HKG', podRaw: 'LAX', forwarderRaw: 'Fairate HK' },
      actorId,
      'ports were UN/LOCODE wrong — use airport codes for air',
    )
    expect(res.edited.sort()).toEqual(['forwarderRaw', 'mode', 'podRaw', 'polRaw'])
    const row = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(row.mode).toBe('AIR')
    expect(row.polRaw).toBe('HKG')
    expect(row.podRaw).toBe('LAX')
    expect(row.forwarderRaw).toBe('Fairate HK')
  })
})

describe('ShipmentsService — contested locks (a newer email overrode a human edit)', () => {
  async function seedContested() {
    const leg = await seedLeg()
    await service.editFields(leg.id, { soNo: 'HUMAN-SO' }, actorId) // locks soNo = HUMAN-SO
    // a newer email applies a different value to the column (what the committer now does over a lock)
    await db.updateTable('shipments').set({ soNo: 'EMAIL-SO' }).where('id', '=', leg.id).execute()
    return leg
  }

  it('detects a field whose column now differs from its human lock', async () => {
    const leg = await seedContested()
    expect(await service.contestedLocks(leg.id)).toEqual([
      { field: 'soNo', yourValue: 'HUMAN-SO', newValue: 'EMAIL-SO' },
    ])
  })

  it('keep-new relocks to the email value and clears the contest', async () => {
    const leg = await seedContested()
    await service.keepNewLockValue(leg.id, 'soNo', actorId)
    expect(await service.contestedLocks(leg.id)).toEqual([])
    const lock = await db
      .selectFrom('fieldLocks').where('entityId', '=', leg.id).where('field', '=', 'soNo')
      .selectAll().executeTakeFirstOrThrow()
    expect(lock.lockedValue).toBe('EMAIL-SO') // relocked to the accepted value
    const after = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(after.soNo).toBe('EMAIL-SO') // column keeps the email value
  })

  it('restore puts the human edit back in the column and clears the contest', async () => {
    const leg = await seedContested()
    await service.restoreLockValue(leg.id, 'soNo', actorId)
    expect(await service.contestedLocks(leg.id)).toEqual([])
    const after = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(after.soNo).toBe('HUMAN-SO') // human edit restored
    const lock = await db
      .selectFrom('fieldLocks').where('entityId', '=', leg.id).where('field', '=', 'soNo')
      .selectAll().executeTakeFirstOrThrow()
    expect(lock.lockedValue).toBe('HUMAN-SO') // lock unchanged
  })
})

describe('ShipmentsService.applyExtractionCorrection — review-queue apply-back', () => {
  it('maps parser fields → leg columns, writes + locks (human-wins) + audits with the note', async () => {
    const leg = await seedLeg()
    const res = await service.applyExtractionCorrection(
      leg.id,
      { booking_no: 'CORRECTED-BK', so_no: 'CORRECTED-SO', customer_code: 'IGNORED' },
      actorId,
      'booking# was truncated in the reply — use the confirmation',
    )
    // customer_code is master-resolved (no direct editable leg column) → skipped
    expect(res.edited.sort()).toEqual(['bookingNo', 'soNo'])

    const [updated] = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().execute()
    expect(updated.bookingNo).toBe('CORRECTED-BK')
    expect(updated.soNo).toBe('CORRECTED-SO')

    // each corrected field is locked (human edit); a newer email that disagrees wins but is flagged
    // CONTESTED (column != lockedValue), never silently dropped
    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', leg.id).selectAll().execute()
    expect(locks.map((l) => l.field).sort()).toEqual(['bookingNo', 'soNo'])

    // the reviewer's note rides each audit row (the agent-soul iteration signal)
    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    expect(audit.find((a) => a.field === 'bookingNo')?.note).toBe('booking# was truncated in the reply — use the confirmation')
    expect(audit.find((a) => a.field === 'bookingNo')?.sourceType).toBe('manual')
  })

  it('coerces typed fields (dates/numbers) through the same path as a manual edit', async () => {
    const leg = await seedLeg()
    await service.applyExtractionCorrection(leg.id, { etd: '2026-03-01', qty: '250' }, actorId, 'from the booking confirmation')
    const [updated] = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().execute()
    expect(updated.etd?.toISOString().slice(0, 10)).toBe('2026-03-01')
    expect(updated.qty).toBe(250)
  })
})
