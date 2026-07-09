import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { sql } from 'kysely'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'

let db: TestDB
beforeAll(async () => { db = (await getTestDb()).db })
afterAll(async () => { await closeTestDb() })
beforeEach(() => resetDb(db))

it('parsed_record round-trips via the kysely mapping', async () => {
  const msg = await db.insertInto('emailMessage')
    .values({ graphMessageId: 'gmsg-ingest-1', subject: 'hi', sender: 'a@b.c' })
    .outputAll('inserted').executeTakeFirstOrThrow()
  await db.insertInto('parsedRecord')
    .values({ messageId: msg.id, graphMessageId: 'gmsg-ingest-1', poNo: 'PO1', fields: JSON.stringify({ customer_code: 'X' }) })
    .execute()
  const r = await sql<{ n: number }>`select count(*) n from parsed_record where po_no = ${'PO1'}`.execute(db)
  expect(Number(r.rows[0]!.n)).toBe(1)
})
