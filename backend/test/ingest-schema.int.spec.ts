import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import * as schema from '../src/db/contracts'

let db: TestDB
beforeAll(async () => { db = (await getTestDb()).db })
afterAll(async () => { await closeTestDb() })
beforeEach(() => resetDb(db))

it('ingest.parsed_record round-trips via the drizzle mapping', async () => {
  const [msg] = await db.insert(schema.ingestEmailMessage)
    .values({ graphMessageId: 'gmsg-ingest-1', subject: 'hi', sender: 'a@b.c' }).returning()
  await db.insert(schema.ingestParsedRecord)
    .values({ messageId: msg!.id, graphMessageId: 'gmsg-ingest-1', poNo: 'PO1', fields: { customer_code: 'X' } })
  const rows = await db.execute(sql`select count(*)::int n from ingest.parsed_record where po_no = 'PO1'`)
  expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(1)
})
