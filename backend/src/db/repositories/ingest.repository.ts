import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
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
 * Idempotent on re-POST, but the two child tables have no natural unique key to conflict on (an
 * attachment's `graph_attachment_id` can be absent; several parsed records legitimately share one
 * `graph_message_id`, distinguished only by `record_idx` — e.g. multiple PO lines parsed out of a
 * single email), so each is made idempotent via delete-then-insert instead of `onConflictDoNothing`:
 *   - `email_message` upserts on its real unique constraint (`graph_message_id`).
 *   - `email_attachment` replaces the WHOLE set for the message — one evidence entry is assumed to
 *     carry that email's complete current attachment list.
 *   - `parsed_record` replaces only its own `(graph_message_id, record_idx)` row, so two evidence
 *     entries for the same email with different `recordIdx` don't clobber each other.
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
        .delete(schema.ingestParsedRecord)
        .where(and(eq(schema.ingestParsedRecord.graphMessageId, e.graphMessageId), eq(schema.ingestParsedRecord.recordIdx, recordIdx)))
      await this.db.insert(schema.ingestParsedRecord).values({
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
    }
  }
}
