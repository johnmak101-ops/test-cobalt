import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { EmailRepository } from '../src/db/repositories/email.repository'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let repo: EmailRepository

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
  repo = new EmailRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

let seq = 0
async function seedMessage(opts: {
  graphMessageId?: string
  subject?: string
  sender?: string
  receivedAt?: Date
  conversationId?: string
  bodyText?: string
  attachmentCount?: number
} = {}) {
  seq += 1
  const gmid = opts.graphMessageId ?? `gmid-${seq}-${Math.random()}`
  const row = await db
    .insertInto('emailMessage')
    .values({
      graphMessageId: gmid,
      subject: opts.subject ?? `Subject ${seq}`,
      sender: opts.sender ?? `s${seq}@x.co`,
      receivedAt: opts.receivedAt ?? new Date(Date.now() + seq * 1000),
      conversationId: opts.conversationId ?? `conv-${seq}`,
      bodyText: opts.bodyText ?? 'body text',
      attachmentCount: opts.attachmentCount ?? 0,
      status: 'DONE',
    })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  return row
}

async function seedAttachment(messageId: string, filename = 'file.pdf') {
  return (await db.insertInto('emailAttachment').values({ messageId, filename, sizeBytes: 10, sourceKind: 'pdf' }).output('inserted.id').executeTakeFirstOrThrow()).id
}

async function seedShipment() {
  const bookingId = (await db.insertInto('bookings').values({ jobNo: `J-${Math.random()}` }).output('inserted.id').executeTakeFirstOrThrow()).id
  return (await db.insertInto('shipments').values({ bookingId }).output('inserted.id').executeTakeFirstOrThrow()).id
}

describe('EmailRepository (SQL Server)', () => {
  it('findIngested finds by graph_message_id, returns null on miss', async () => {
    const m = await seedMessage({ subject: 'findme' })
    const found = await repo.findIngested(m.graphMessageId)
    expect(found?.subject).toBe('findme')
    expect(await repo.findIngested('does-not-exist')).toBeNull()
  })

  it('attachmentById + attachmentsFor join the message graph id', async () => {
    const m = await seedMessage({ graphMessageId: 'gmid-att' })
    const attId = await seedAttachment(m.id, 'doc.pdf')
    const byId = await repo.attachmentById(attId)
    expect(byId[0]).toMatchObject({ attachmentId: attId, filename: 'doc.pdf', messageGraphId: 'gmid-att' })
    const forMsg = await repo.attachmentsFor('gmid-att')
    expect(forMsg.length).toBe(1)
    expect(forMsg[0].messageGraphId).toBe('gmid-att')
    // miss
    expect(await repo.attachmentsFor('no-such-gmid')).toEqual([])
  })

  it('listInbox orders newest-received first + carries the review overlay + matchedShipmentId', async () => {
    const old = await seedMessage({ subject: 'old-inbox', receivedAt: new Date('2026-07-01T00:00:00Z') })
    const newer = await seedMessage({ subject: 'new-inbox', receivedAt: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000) })
    // attach a review_email overlay to one + link a milestone (matchedShipmentId)
    const shipmentId = await seedShipment()
    await db.insertInto('reviewEmail').values({
      messageId: old.id, reviewStatus: 'NEEDS_REVIEW', emailType: 'Booking Request', extractionConfidence: 0.42,
    }).execute()
    await db.insertInto('shipmentMilestones').values({
      shipmentId, milestoneType: 'BOOKING_SENT', occurredAt: new Date(), emailMessageId: old.graphMessageId,
    }).execute()

    const rows = await repo.listInbox(50)
    // the newest-seeded message must be first (far-future receivedAt)
    expect(rows[0].id).toBe(newer.id)
    const oldRow = rows.find((r) => r.subject === 'old-inbox')!
    expect(oldRow.reviewStatus).toBe('NEEDS_REVIEW')
    expect(oldRow.extractionConfidence).toBe(0.42)
    expect(oldRow.matchedShipmentId?.toLowerCase()).toBe(shipmentId.toLowerCase())
  })

  it('markRead is idempotent; unreadCount drops then stays', async () => {
    const m = await seedMessage({ subject: 'unread-test' })
    const before = await repo.unreadCount()
    await repo.markRead(m.id, null)
    expect(await repo.unreadCount()).toBe(before - 1)
    // idempotent — second call doesn't throw, count unchanged
    await repo.markRead(m.id, null)
    expect(await repo.unreadCount()).toBe(before - 1)
  })

  it('ingestionStatus (count + lastAt) + ingestState (watermark row)', async () => {
    await seedMessage({ subject: 'stat-test' })
    const s = await repo.ingestionStatus()
    expect(s.count).toBeGreaterThanOrEqual(1)
    expect(s.lastAt).toBeInstanceOf(Date)
    // ingest_state watermark
    await db.insertInto('ingestState').values({ id: 'graph', lastSyncAt: new Date(), watermark: new Date('2026-07-01T00:00:00Z') }).execute()
    const st = await repo.ingestState()
    expect(st?.id).toBe('graph')
  })

  it('emailsForShipment + emailsForShipments join via shipment_emails.graph_message_id', async () => {
    const shipmentId = await seedShipment()
    const m = await seedMessage({ subject: 'ship-email', graphMessageId: 'gmid-ship' })
    await db.insertInto('shipmentEmails').values({ shipmentId, graphMessageId: m.graphMessageId, emailType: 'Booking Request' }).execute()
    const one = await repo.emailsForShipment(shipmentId)
    expect(one[0]).toMatchObject({ subject: 'ship-email', milestoneType: 'Booking Request' })
    // batch
    const batch = await repo.emailsForShipments([shipmentId])
    expect(batch.get(shipmentId)?.[0].subject).toBe('ship-email')
    // empty input → empty map, no query
    expect((await repo.emailsForShipments([])).size).toBe(0)
    // no links → empty
    const other = randomUUID()
    expect(await repo.emailsForShipment(other)).toEqual([])
  })

  it('countPendingReview counts NEEDS_REVIEW rows only', async () => {
    const m = await seedMessage({ subject: 'pending-test' })
    await db.insertInto('reviewEmail').values({ messageId: m.id, reviewStatus: 'NEEDS_REVIEW' }).execute()
    const c = await repo.countPendingReview()
    expect(c).toBeGreaterThanOrEqual(1)
  })

  it('attachmentsByMessageId + emailBody by email_message id', async () => {
    const m = await seedMessage({ subject: 'body-test', bodyText: 'hello body' })
    await seedAttachment(m.id, 'a.pdf')
    await seedAttachment(m.id, 'b.pdf')
    const atts = await repo.attachmentsByMessageId(m.id)
    expect(atts.length).toBe(2)
    const body = await repo.emailBody(m.id)
    expect(body?.bodyText).toBe('hello body')
    expect(await repo.emailBody('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('thread groups by conversationId, oldest first, with attachment counts', async () => {
    const conv = 'conv-thread-1'
    const m1 = await seedMessage({ subject: 'first', receivedAt: new Date('2026-07-01T00:00:00Z'), conversationId: conv })
    const m2 = await seedMessage({ subject: 'second', receivedAt: new Date('2026-07-02T00:00:00Z'), conversationId: conv })
    await seedAttachment(m2.id, 'only-on-second.pdf')
    // a different conversation must NOT appear
    await seedMessage({ subject: 'other-conv', conversationId: 'conv-other' })

    const th = await repo.thread(m1.id)
    expect(th.map((r) => r.subject)).toEqual(['first', 'second'])
    expect(th[0].attachmentCount).toBe(0)
    expect(th[1].attachmentCount).toBe(1)
  })

  it('thread returns [] when the message has no conversationId', async () => {
    const m = await db.insertInto('emailMessage').values({
      graphMessageId: 'gmid-noconv', subject: 'noconv', sender: 's@x.co',
      receivedAt: new Date(), conversationId: null, bodyText: 'x', attachmentCount: 0,
    }).outputAll('inserted').executeTakeFirstOrThrow()
    expect(await repo.thread(m.id)).toEqual([])
  })
})
