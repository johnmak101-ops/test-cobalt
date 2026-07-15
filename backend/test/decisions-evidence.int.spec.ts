import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from 'kysely'
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
  const committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder)
  const settings = new SettingsService(r.settings)
  decisions = new DecisionsService(committer, settings, ingestRepo, r.routingShadow)
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
    const r = await sql<{ m: number; p: number; a: number }>`select
      (select count(*) from email_message where graph_message_id = 'g1') m,
      (select count(*) from parsed_record where graph_message_id = 'g1') p,
      (select count(*) from email_attachment) a`.execute(db)
    const row = r.rows[0]!
    expect([Number(row.m), Number(row.p), Number(row.a)]).toEqual([1, 1, 1])
  })

  it('two parsed records from the SAME email (distinct recordIdx) do not clobber each other, and a re-POST stays idempotent', async () => {
    const ev = [
      { graphMessageId: 'g2', recordIdx: 0, poNo: 'PO-A', fields: { line: 1 } },
      { graphMessageId: 'g2', recordIdx: 1, poNo: 'PO-B', fields: { line: 2 } },
    ]
    await ingestRepo.upsertFromDecision(ev)
    await ingestRepo.upsertFromDecision(ev) // re-POST of the same 2-record batch

    const messages = await db.selectFrom('emailMessage').where('graphMessageId', '=', 'g2').selectAll().execute()
    expect(messages).toHaveLength(1) // one email, upserted not duplicated

    const records = await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'g2').selectAll().execute()
    expect(records).toHaveLength(2) // both recordIdx rows survive — neither clobbered the other
    expect(records.map((r) => r.poNo).sort()).toEqual(['PO-A', 'PO-B'])
  })

  it('two evidence[] entries with the SAME graphMessageId AND SAME recordIdx in ONE call upsert to a single row (last wins, not a silent duplicate/loss)', async () => {
    const ev = [
      { graphMessageId: 'g-dup', recordIdx: 0, poNo: 'FIRST', fields: { line: 'first' } },
      { graphMessageId: 'g-dup', recordIdx: 0, poNo: 'SECOND', fields: { line: 'second' } },
    ]
    await ingestRepo.upsertFromDecision(ev) // a same-batch collision on (graph_message_id, record_idx)

    const records = await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'g-dup').selectAll().execute()
    expect(records).toHaveLength(1) // the unique constraint's upsert collapses the collision, it never inserts twice
    expect(records[0]!.poNo).toBe('SECOND') // last entry in the batch wins
  })

  it('a message upsert refreshes metadata (e.g. subject correction on a follow-up POST)', async () => {
    await ingestRepo.upsertFromDecision([{ graphMessageId: 'g3', subject: 'first cut' }])
    await ingestRepo.upsertFromDecision([{ graphMessageId: 'g3', subject: 'corrected subject' }])
    const msg = await db.selectFrom('emailMessage').where('graphMessageId', '=', 'g3').selectAll().executeTakeFirst()
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

    const msg = await db.selectFrom('emailMessage').where('graphMessageId', '=', 'g-ev-1').selectAll().executeTakeFirst()
    expect(msg?.subject).toBe('hello')
    const attachments = await db.selectFrom('emailAttachment').where('messageId', '=', msg!.id).selectAll().execute()
    expect(attachments).toHaveLength(1)
  })

  it('a legacy decision WITHOUT evidence[] writes nothing to ingest.* (additive/back-compat)', async () => {
    const res = await decisions.ingest(decision())
    expect(res.action).not.toBe('skip')
    expect(await db.selectFrom('emailMessage').selectAll().execute()).toHaveLength(0)
    expect(await db.selectFrom('parsedRecord').selectAll().execute()).toHaveLength(0)
  })

  it('re-POSTing the SAME decision + evidence[] stays idempotent end-to-end', async () => {
    const dto = decision({ evidence: [{ graphMessageId: 'g-ev-2', subject: 's2', fields: { so_no: 'SO-EV' } }] })
    await decisions.ingest(dto)
    await decisions.ingest(dto)
    expect(await db.selectFrom('emailMessage').where('graphMessageId', '=', 'g-ev-2').selectAll().execute()).toHaveLength(1)
    expect(await db.selectFrom('parsedRecord').where('graphMessageId', '=', 'g-ev-2').selectAll().execute()).toHaveLength(1)
  })
})
