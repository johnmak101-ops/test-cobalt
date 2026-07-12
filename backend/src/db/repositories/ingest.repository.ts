import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import { evidencePoNorm } from '../../reconcile/evidence-po-norm'

export interface EvidenceInput {
  graphMessageId: string
  /** Microsoft Graph item id (AAMk…) — enables on-demand body re-fetch when local body is empty/purged. */
  graphId?: string | null
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
  bodyText?: string | null
  bodyHtml?: string | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string }[]
}

/**
 * Kysely/SQL Server port of IngestRepository. Persists per-email parsed records + metadata into the
 * `ingest` mirror (email_message / email_attachment / parsed_record) — the RECEIVE side of cobalt-queue's
 * POST /api/decisions evidence[].
 *
 * Idempotent on re-POST (mirrors the Drizzle onConflictDoUpdate semantics):
 *   - email_message upserts on graph_message_id (check-then-update-or-insert — MSSQL has no ON CONFLICT).
 *   - email_attachment has no natural unique key → replace-in-place via delete-then-insert.
 *   - parsed_record upserts on (graph_message_id, record_idx).
 *
 * Each evidence entry's writes run in ONE transaction (atomic: a crash can't leave half-written children).
 */
@Injectable()
export class IngestRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async upsertFromDecision(evidence: EvidenceInput[]): Promise<void> {
    for (const e of evidence) {
      await this.db.transaction().execute(async (tx) => {
        const receivedAt = e.receivedAt ? new Date(e.receivedAt) : null
        const attachmentCount = e.attachments?.length ?? 0

        // email_message upsert on graph_message_id — also stores body + Graph item id for "view original"
        const existing = await tx.selectFrom('emailMessage').where('graphMessageId', '=', e.graphMessageId).select('id').executeTakeFirst()
        let msgId: string
        const emailPatch = {
          subject: e.subject ?? null,
          sender: e.sender ?? null,
          receivedAt,
          conversationId: e.conversationId ?? null,
          sourceFile: e.sourceFile ?? null,
          attachmentCount,
          graphId: e.graphId ?? null,
          bodyText: e.bodyText ?? null,
          bodyHtml: e.bodyHtml ?? null,
        }
        if (existing) {
          await tx.updateTable('emailMessage').set(emailPatch).where('id', '=', existing.id).execute()
          msgId = existing.id
        } else {
          const inserted = await tx.insertInto('emailMessage').values({
            graphMessageId: e.graphMessageId,
            ...emailPatch,
            status: 'DONE',
          }).output('inserted.id').executeTakeFirstOrThrow()
          msgId = inserted.id
        }

        // attachments: replace-in-place (no natural unique key)
        await tx.deleteFrom('emailAttachment').where('messageId', '=', msgId).execute()
        if (e.attachments?.length) {
          await tx.insertInto('emailAttachment').values(
            e.attachments.map((a) => ({
              messageId: msgId, graphAttachmentId: a.graphAttachmentId, filename: a.filename,
              declaredMime: a.declaredMime ?? null, sizeBytes: a.sizeBytes ?? 0, sourceKind: a.sourceKind ?? null,
            })),
          ).execute()
        }

        // parsed_record upsert on (graph_message_id, record_idx)
        const recordIdx = e.recordIdx ?? 0
        const fieldsJson = JSON.stringify(e.fields ?? {})
        const matchKeysJson = JSON.stringify(e.matchKeys ?? {})
        const poNoNorm = evidencePoNorm(e.poNo, e.matchKeys ?? null)
        const existingRec = await tx.selectFrom('parsedRecord')
          .where('graphMessageId', '=', e.graphMessageId).where('recordIdx', '=', recordIdx)
          .select('id').executeTakeFirst()
        if (existingRec) {
          await tx.updateTable('parsedRecord').set({
            messageId: msgId, poNo: e.poNo ?? null, poNoNorm, emailType: e.emailType ?? null,
            senderType: e.senderType ?? null, mode: e.mode ?? null, fields: fieldsJson, matchKeys: matchKeysJson,
          }).where('id', '=', existingRec.id).execute()
        } else {
          await tx.insertInto('parsedRecord').values({
            messageId: msgId, graphMessageId: e.graphMessageId, recordIdx,
            poNo: e.poNo ?? null, poNoNorm, emailType: e.emailType ?? null, senderType: e.senderType ?? null,
            mode: e.mode ?? null, fields: fieldsJson, matchKeys: matchKeysJson,
          }).execute()
        }
      })
    }
  }
}
