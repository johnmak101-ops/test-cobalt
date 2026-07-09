import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { KyselyEvidenceRepository } from '../src/db/repositories/evidence.repository.kysely'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db.generated'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'
const RUN = process.env.FABRIC_FOUNDATION === '1'

let db: Kysely<DB>
let repo: KyselyEvidenceRepository

beforeAll(async () => {
  if (!RUN) return
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
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
  repo = new KyselyEvidenceRepository(db)
})
afterAll(async () => {
  if (!RUN) return
  await db.destroy()
})

async function seedMsg(gmid: string, subject: string, sender: string) {
  const m = await db.insertInto('emailMessage').values({ graphMessageId: gmid, subject, sender }).output('inserted.id').executeTakeFirstOrThrow()
  return m.id
}
async function seedRec(messageId: string, gmid: string, fields: Record<string, unknown>, poNo: string) {
  await db.insertInto('parsedRecord').values({ messageId, graphMessageId: gmid, fields: JSON.stringify(fields), poNo }).execute()
}

describe.runIf(RUN)('KyselyEvidenceRepository (SQL Server)', () => {
  it('forMessages joins parsed_record → email_message and returns the selected columns', async () => {
    const id1 = await seedMsg('gm1', 'subj-1', 'a@b.c')
    const id2 = await seedMsg('gm2', 'subj-2', 'x@y.z')
    await seedRec(id1, 'gm1', { customer_code: 'X' }, 'PO1')
    await seedRec(id2, 'gm2', { customer_code: 'Y' }, 'PO2')

    const rows = await repo.forMessages([id1, id2])
    expect(rows.length).toBe(2)
    const r1 = rows.find((r) => r.messageId === id1)!
    expect(r1).toMatchObject({ subject: 'subj-1', sender: 'a@b.c' })
    expect(r1.fields).toMatchObject({ customer_code: 'X' }) // json parsed
  })

  it('forMessages returns [] for an empty id list (no IN() on empty)', async () => {
    expect(await repo.forMessages([])).toEqual([])
  })

  it('allWithMessage returns all records joined with their email_message', async () => {
    const id1 = await seedMsg('gm3', 's3', 'p@q.r')
    await seedRec(id1, 'gm3', { foo: 1 }, 'PO3')
    const rows = await repo.allWithMessage()
    const r = rows.find((x) => x.poNo === 'PO3')!
    expect(r).toMatchObject({ sender: 'p@q.r', conversationId: null, mode: null })
    expect(r.fields).toMatchObject({ foo: 1 })
    expect(r.matchKeys).toBeNull()
  })

  it('sendersByGraphIds returns senders keyed by graph_message_id', async () => {
    await seedMsg('gm4', 's4', 'sender4@x.co')
    await seedMsg('gm5', 's5', 'sender5@x.co')
    const rows = await repo.sendersByGraphIds(['gm4', 'gm5', 'gm-NONEXIST'])
    expect(rows.length).toBe(2)
    expect(rows.find((r) => r.graphMessageId === 'gm4')?.sender).toBe('sender4@x.co')
  })
})
