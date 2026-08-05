import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { ReviewEmailRepository } from '../src/db/repositories/review-email.repository'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'
import type { Insertable } from 'kysely'

type ShipmentState = NonNullable<Insertable<DB['shipments']>['state']>

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let repo: ReviewEmailRepository

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
  repo = new ReviewEmailRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

async function seedReviewEmail(opts: {
  subject?: string
  sender?: string
  receivedAt?: Date
  confidence?: number | null
  status?: string
  shipmentId?: string | null
}) {
  const row = await db
    .insertInto('reviewEmail')
    .values({
      graphMessageId: `gmid-${Math.random()}`,
      subject: opts.subject ?? 'S',
      sender: opts.sender ?? 's@x.co',
      receivedAt: opts.receivedAt ?? new Date('2026-07-01T00:00:00Z'),
      bodyText: 'body',
      emailType: 'Booking Request',
      extractionConfidence: opts.confidence ?? null,
      reviewStatus: opts.status ?? 'NEEDS_REVIEW',
      shipmentId: opts.shipmentId ?? null,
    })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  return row
}

async function seedBookingShipment(state: ShipmentState = 'BOOKED') {
  const bookingId = (await db.insertInto('bookings').values({ jobNo: `J-${Math.random()}` }).output('inserted.id').executeTakeFirstOrThrow()).id
  const shipmentId = (await db.insertInto('shipments').values({ bookingId, state }).output('inserted.id').executeTakeFirstOrThrow()).id
  return { bookingId, shipmentId }
}

describe('ReviewEmailRepository (SQL Server)', () => {
  it('listByStatus defaults to NEEDS_REVIEW, ordered lowest-confidence-first then newest-received', async () => {
    // three pending: conf 0.9 (older), 0.5, 0.9 (newer)
    await seedReviewEmail({ confidence: 0.9, receivedAt: new Date('2026-07-01T00:00:00Z') })
    await seedReviewEmail({ confidence: 0.5, receivedAt: new Date('2026-07-03T00:00:00Z') })
    await seedReviewEmail({ confidence: 0.9, receivedAt: new Date('2026-07-05T00:00:00Z') })
    // a reviewed one must NOT appear in the default tab
    await seedReviewEmail({ confidence: 0.1, status: 'REVIEWED_OK' })

    const rows = await repo.listByStatus()
    expect(rows.every((r) => r.reviewStatus === 'NEEDS_REVIEW')).toBe(true)
    expect(rows.length).toBe(3)
    // lowest confidence first
    expect(rows[0].extractionConfidence).toBe(0.5)
    // among the two 0.9s, newest received first
    const nineties = rows.filter((r) => r.extractionConfidence === 0.9)
    expect(nineties[0].receivedAt!.getTime()).toBeGreaterThan(nineties[1].receivedAt!.getTime())
  })

  it('listByStatus(status) returns only that status, with light shipment context joined', async () => {
    const { shipmentId } = await seedBookingShipment('SAILED')
    const linked = await seedReviewEmail({ status: 'REVIEWED_OK', shipmentId, subject: 'linked-re' })
    const unlinked = await seedReviewEmail({ status: 'REVIEWED_OK', shipmentId: null, subject: 'unlinked-re' })

    const rows = await repo.listByStatus('REVIEWED_OK')
    expect(rows.every((r) => r.reviewStatus === 'REVIEWED_OK')).toBe(true)
    const l = rows.find((r) => r.id === linked.id)!
    expect(l.shipmentState).toBe('SAILED') // joined from shipments
    expect(l.shipmentId?.toLowerCase()).toBe(shipmentId.toLowerCase())
    const u = rows.find((r) => r.id === unlinked.id)!
    expect(u.shipmentState).toBeNull()
  })

  it('counts returns per-status badges; AUTO_ACCEPTED (never seeded) stays 0', async () => {
    await seedReviewEmail({ status: 'NEEDS_REVIEW' })
    await seedReviewEmail({ status: 'NEEDS_REVIEW' })
    await seedReviewEmail({ status: 'REJECTED' })
    const c = await repo.counts()
    expect(c.NEEDS_REVIEW).toBeGreaterThanOrEqual(2)
    expect(c.REJECTED).toBeGreaterThanOrEqual(1)
    // a status no test in this file ever seeds stays at 0
    expect(c.AUTO_ACCEPTED).toBe(0)
  })

  it('findById returns the row (null when missing)', async () => {
    const inserted = await seedReviewEmail({ subject: 'findme' })
    const row = await repo.findById(inserted.id)
    expect(row?.subject).toBe('findme')
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('update sets the review-state fields + bumps updatedAt', async () => {
    const inserted = await seedReviewEmail({ status: 'NEEDS_REVIEW' })
    const at = new Date('2026-07-08T00:00:00Z')
    const row = await repo.update(inserted.id, {
      reviewStatus: 'REVIEWED_CORRECTED', reviewedBy: null, reviewedAt: at, reviewNotes: 'fixed pol',
    })
    expect(row?.reviewStatus).toBe('REVIEWED_CORRECTED')
    expect(row?.reviewedAt).toEqual(at)
    expect(row?.reviewNotes).toBe('fixed pol')
    // 2ms slack: the insert's updatedAt comes from the DB clock (SYSDATETIMEOFFSET) while update() stamps
    // a JS Date — the two sources + tedious ms-rounding can differ by 1ms in either direction (seen flaky).
    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(inserted.updatedAt.getTime() - 2)
    // reflected on re-read
    expect((await repo.findById(inserted.id))?.reviewStatus).toBe('REVIEWED_CORRECTED')
  })
})
