import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { IngestRepository, type EvidenceInput } from '../src/db/repositories/ingest.repository'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let repo: IngestRepository

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
  repo = new IngestRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

describe('IngestRepository (SQL Server)', () => {
  it('upserts email_message + parsed_record + attachments; idempotent on re-POST', async () => {
    const ev: EvidenceInput = {
      graphMessageId: 'gmsg-1', subject: 'hi', sender: 'a@b.c', receivedAt: '2026-01-01T00:00:00Z',
      recordIdx: 0, poNo: 'PO1', fields: { customer_code: 'X' }, matchKeys: { hbl: 'H1' },
      attachments: [{ graphAttachmentId: 'ga1', filename: 'f.pdf', sizeBytes: 100 }],
    }
    await repo.upsertFromDecision([ev])

    const msg = await db.selectFrom('emailMessage').where('graphMessageId', '=', 'gmsg-1').selectAll().executeTakeFirstOrThrow()
    expect(msg.subject).toBe('hi')
    expect(msg.attachmentCount).toBe(1)
    const rec = await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'gmsg-1').selectAll().executeTakeFirstOrThrow()
    expect(rec.poNo).toBe('PO1')
    expect(rec.fields).toMatchObject({ customer_code: 'X' }) // json parsed
    const atts = await db.selectFrom('emailAttachment').where('messageId', '=', msg.id).selectAll().execute()
    expect(atts.length).toBe(1)
    expect(atts[0]!.filename).toBe('f.pdf')

    // re-POST with changed fields + a different attachment set → upserts in place, no duplicates
    await repo.upsertFromDecision([{ ...ev, subject: 'hi2', poNo: 'PO2', attachments: [{ graphAttachmentId: 'ga2', filename: 'g.pdf' }] }])
    const msgs = await db.selectFrom('emailMessage').where('graphMessageId', '=', 'gmsg-1').selectAll().execute()
    expect(msgs.length).toBe(1) // upserted, not duplicated
    expect(msgs[0]!.subject).toBe('hi2')
    const recs = await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'gmsg-1').selectAll().execute()
    expect(recs.length).toBe(1)
    expect(recs[0]!.poNo).toBe('PO2')
    const atts2 = await db.selectFrom('emailAttachment').where('messageId', '=', msg.id).selectAll().execute()
    expect(atts2.length).toBe(1) // replaced, not appended
    expect(atts2[0]!.filename).toBe('g.pdf')
  })

  it('upserts multiple records for one email with distinct recordIdx (no clobber)', async () => {
    await repo.upsertFromDecision([
      { graphMessageId: 'gmsg-2', recordIdx: 0, poNo: 'PO-A' },
      { graphMessageId: 'gmsg-2', recordIdx: 1, poNo: 'PO-B' },
    ])
    const recs = await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'gmsg-2').orderBy('recordIdx').selectAll().execute()
    expect(recs.map((r) => r.poNo)).toEqual(['PO-A', 'PO-B'])
    expect(recs.length).toBe(2)
  })
})
