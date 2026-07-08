import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

export interface EvidenceInput {
  graphMessageId: string
  recordIdx?: number
  poNo?: string | null
  emailType?: string | null
  senderType?: string | null
  mode?: string | null
  fields?: Record<string, unknown>
  matchKeys?: Record<string, unknown>
  subject?: string | null
  sender?: string | null
  receivedAt?: string | null
  conversationId?: string | null
  sourceFile?: string | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string }[]
}

/**
 * Persists the per-email parsed records + email metadata a decision carries into ShipTrack's own
 * `ingest` mirror (`email_message` / `email_attachment` / `parsed_record`) — the RECEIVE side of the
 * cross-service push from cobalt-queue's `POST /api/decisions` `evidence[]`.
 *
 * Idempotent on re-POST:
 *   - `email_message` upserts on its real unique constraint (`graph_message_id`).
 *   - `email_attachment` has no natural unique key to conflict on (a `graph_attachment_id` can be
 *     absent), so it replaces the WHOLE set for the message via delete-then-insert — one evidence
 *     entry is assumed to carry that email's complete current attachment list.
 *   - `parsed_record` upserts on the real `(graph_message_id, record_idx)` unique constraint, so two
 *     evidence entries for the same email with different `recordIdx` don't clobber each other, AND a
 *     same-key duplicate (same-batch or concurrent re-POST) safely updates in place — last write wins,
 *     via the database's own conflict detection — instead of the old delete-then-insert dance, which
 *     could race under true concurrency (both sides find nothing to delete, then both insert).
 */
@Injectable()
export class IngestRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async upsertFromDecision(evidence: EvidenceInput[]): Promise<void> {
    for (const e of evidence) {
      const receivedAt = e.receivedAt ? new Date(e.receivedAt) : null
      const [msg] = await this.db
        .insert(schema.ingestEmailMessage)
        .values({
          graphMessageId: e.graphMessageId,
          subject: e.subject ?? null,
          sender: e.sender ?? null,
          receivedAt,
          conversationId: e.conversationId ?? null,
          sourceFile: e.sourceFile ?? null,
          attachmentCount: e.attachments?.length ?? 0,
          status: 'DONE',
        })
        .onConflictDoUpdate({
          target: schema.ingestEmailMessage.graphMessageId,
          set: {
            subject: e.subject ?? null,
            sender: e.sender ?? null,
            receivedAt,
            conversationId: e.conversationId ?? null,
            sourceFile: e.sourceFile ?? null,
            attachmentCount: e.attachments?.length ?? 0,
          },
        })
        .returning()

      // No unique constraint on the children — replace-in-place so a re-POST never duplicates (see class doc).
      await this.db.delete(schema.ingestEmailAttachment).where(eq(schema.ingestEmailAttachment.messageId, msg!.id))
      if (e.attachments?.length) {
        await this.db.insert(schema.ingestEmailAttachment).values(
          e.attachments.map((a) => ({
            messageId: msg!.id,
            graphAttachmentId: a.graphAttachmentId,
            filename: a.filename,
            declaredMime: a.declaredMime ?? null,
            sizeBytes: a.sizeBytes ?? 0,
            sourceKind: a.sourceKind ?? null,
          })),
        )
      }

      const recordIdx = e.recordIdx ?? 0
      await this.db
        .insert(schema.ingestParsedRecord)
        .values({
          messageId: msg!.id,
          graphMessageId: e.graphMessageId,
          recordIdx,
          poNo: e.poNo ?? null,
          emailType: e.emailType ?? null,
          senderType: e.senderType ?? null,
          mode: e.mode ?? null,
          fields: e.fields ?? {},
          matchKeys: e.matchKeys ?? {},
        })
        .onConflictDoUpdate({
          target: [schema.ingestParsedRecord.graphMessageId, schema.ingestParsedRecord.recordIdx],
          set: {
            poNo: sql`excluded.po_no`,
            emailType: sql`excluded.email_type`,
            senderType: sql`excluded.sender_type`,
            mode: sql`excluded.mode`,
            fields: sql`excluded.fields`,
            matchKeys: sql`excluded.match_keys`,
            messageId: sql`excluded.message_id`,
          },
        })
    }
  }
}
