import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, closeTestDb, resetDb, repos, type TestDB } from './setup-db'
import { IngestRepository } from '../src/db/repositories/ingest.repository'
import { CommitterService } from '../src/reconcile/committer.service'
import { DecisionsService } from '../src/decisions/decisions.service'
import { SettingsService } from '../src/settings/settings.service'
import type { CreateDecisionDto } from '../src/decisions/dto'

let db: TestDB
let ingestRepo: IngestRepository
let decisions: DecisionsService

beforeAll(async () => {
  db = (await getTestDb()).db
  const r = repos(db)
  ingestRepo = r.ingest
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence)
  const settings = new SettingsService(r.settings)
  decisions = new DecisionsService(committer, settings, ingestRepo)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('IngestRepository.upsertFromDecision (integration)', () => {
  it('persists evidence[] into ingest.* idempotently', async () => {
    const ev = [
      {
        graphMessageId: 'g1',
        recordIdx: 0,
        poNo: 'PO9',
        subject: 's',
        fields: { customer_code: 'C' },
        attachments: [{ graphAttachmentId: 'a1', filename: 'x.pdf' }],
      },
    ]
    await ingestRepo.upsertFromDecision(ev)
    await ingestRepo.upsertFromDecision(ev) // re-POST of the identical batch
    const r = await db.execute(sql`select
      (select count(*) from ingest.email_message where graph_message_id='g1') m,
      (select count(*) from ingest.parsed_record where graph_message_id='g1') p,
      (select count(*) from ingest.email_attachment) a`)
    const row = (r as unknown as { rows: { m: number; p: number; a: number }[] }).rows[0]!
    expect([Number(row.m), Number(row.p), Number(row.a)]).toEqual([1, 1, 1])
  })

  it('two parsed records from the SAME email (distinct recordIdx) do not clobber each other, and a re-POST stays idempotent', async () => {
    const ev = [
      { graphMessageId: 'g2', recordIdx: 0, poNo: 'PO-A', fields: { line: 1 } },
      { graphMessageId: 'g2', recordIdx: 1, poNo: 'PO-B', fields: { line: 2 } },
    ]
    await ingestRepo.upsertFromDecision(ev)
    await ingestRepo.upsertFromDecision(ev) // re-POST of the same 2-record batch

    const messages = await db.select().from(schema.ingestEmailMessage).where(eq(schema.ingestEmailMessage.graphMessageId, 'g2'))
    expect(messages).toHaveLength(1) // one email, upserted not duplicated

    const records = await db.select().from(schema.ingestParsedRecord).where(eq(schema.ingestParsedRecord.graphMessageId, 'g2'))
    expect(records).toHaveLength(2) // both recordIdx rows survive — neither clobbered the other
    expect(records.map((r) => r.poNo).sort()).toEqual(['PO-A', 'PO-B'])
  })

  it('a message upsert refreshes metadata (e.g. subject correction on a follow-up POST)', async () => {
    await ingestRepo.upsertFromDecision([{ graphMessageId: 'g3', subject: 'first cut' }])
    await ingestRepo.upsertFromDecision([{ graphMessageId: 'g3', subject: 'corrected subject' }])
    const [msg] = await db.select().from(schema.ingestEmailMessage).where(eq(schema.ingestEmailMessage.graphMessageId, 'g3'))
    expect(msg?.subject).toBe('corrected subject')
  })
})

describe('POST /api/decisions evidence[] wiring (DecisionsService.ingest)', () => {
  const decision = (over: Partial<CreateDecisionDto> = {}): CreateDecisionDto => ({
    matchKey: { so_no: 'SO-EV' },
    fields: { so_no: 'SO-EV' },
    confidence: 90,
    ...over,
  })

  it('a decision carrying evidence[] persists it into ingest.* alongside the normal commit', async () => {
    const res = await decisions.ingest(
      decision({
        evidence: [
          {
            graphMessageId: 'g-ev-1',
            subject: 'hello',
            fields: { so_no: 'SO-EV' },
            attachments: [{ graphAttachmentId: 'att-1', filename: 'po.pdf' }],
          },
        ],
      }),
    )
    expect(res.action).not.toBe('skip') // the commit path is unaffected by the evidence side-write

    const [msg] = await db.select().from(schema.ingestEmailMessage).where(eq(schema.ingestEmailMessage.graphMessageId, 'g-ev-1'))
    expect(msg?.subject).toBe('hello')
    const attachments = await db.select().from(schema.ingestEmailAttachment).where(eq(schema.ingestEmailAttachment.messageId, msg!.id))
    expect(attachments).toHaveLength(1)
  })

  it('a legacy decision WITHOUT evidence[] writes nothing to ingest.* (additive/back-compat)', async () => {
    const res = await decisions.ingest(decision())
    expect(res.action).not.toBe('skip')
    expect(await db.select().from(schema.ingestEmailMessage)).toHaveLength(0)
    expect(await db.select().from(schema.ingestParsedRecord)).toHaveLength(0)
  })

  it('re-POSTing the SAME decision + evidence[] stays idempotent end-to-end', async () => {
    const dto = decision({ evidence: [{ graphMessageId: 'g-ev-2', subject: 's2', fields: { so_no: 'SO-EV' } }] })
    await decisions.ingest(dto)
    await decisions.ingest(dto)
    expect(await db.select().from(schema.ingestEmailMessage).where(eq(schema.ingestEmailMessage.graphMessageId, 'g-ev-2'))).toHaveLength(1)
    expect(await db.select().from(schema.ingestParsedRecord).where(eq(schema.ingestParsedRecord.graphMessageId, 'g-ev-2'))).toHaveLength(1)
  })
})
