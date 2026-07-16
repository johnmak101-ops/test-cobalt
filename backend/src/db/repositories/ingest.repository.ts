import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import { evidencePoNorm } from '../../reconcile/evidence-po-norm'
import { resolveAttachmentRawBytes } from './attachment-bytes-carry'

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
  /** cobalt-queue soul version (queue.prompt_version.id) that produced this parse — provenance (queue v1, §4.6d). */
  promptVersion?: number | null
  attachments?: { graphAttachmentId: string; filename: string; declaredMime?: string; sizeBytes?: number; sourceKind?: string; rawBytesB64?: string | null }[]
}

/**
 * Kysely/SQL Server port of IngestRepository. Persists per-email parsed records + metadata into the
 * `ingest` mirror (email_message / email_attachment / parsed_record) — the RECEIVE side of cobalt-queue's
 * POST /api/decisions evidence[].
 *
 * Idempotent on re-POST (mirrors the Drizzle onConflictDoUpdate semantics):
 *   - email_message upserts on graph_message_id (check-then-update-or-insert — MSSQL has no ON CONFLICT).
 *   - email_attachment has no natural unique key → replace-in-place via delete-then-insert,
 *     but rawBytes are carried forward when re-POST has none (#177 / queue #151 purge re-match).
 *   - parsed_record upserts on (graph_message_id, record_idx).
 *
 * Each evidence entry's writes run in ONE transaction (atomic: a crash can't leave half-written children).
 */
@Injectable()
export class IngestRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async upsertFromDecision(evidence: EvidenceInput[]): Promise<void> {
    // Group by message. email_message (body) and email_attachment are MESSAGE-level, so process them ONCE
    // per graph_message_id — NOT once per parsed record. Two reasons: (1) the queue now sends body +
    // attachments on only the FIRST record of each message (a 51-PO email replicated its bodyHtml ×51 and
    // pushed the decision POST toward the 25MB cap); (2) even under the old "on every record" payload, the
    // per-record loop replayed the same message/attachment writes N times and a later null-body record would
    // clobber the body via last-writer-wins. Pick the non-null body / non-empty attachments across the
    // message's records so it's order-independent; parsed_record is still per (graph_message_id, record_idx).
    const byMsg = new Map<string, EvidenceInput[]>()
    for (const e of evidence) {
      const list = byMsg.get(e.graphMessageId) ?? []
      list.push(e)
      byMsg.set(e.graphMessageId, list)
    }

    for (const [graphMessageId, entries] of byMsg) {
      const head = entries[0]! // subject/sender/graphId/etc. are identical across a message's records
      const bodyE = entries.find((e) => e.bodyText != null || e.bodyHtml != null) ?? head
      const attE = entries.find((e) => e.attachments?.length) ?? head
      await this.db.transaction().execute(async (tx) => {
        const receivedAt = head.receivedAt ? new Date(head.receivedAt) : null
        const attachmentCount = attE.attachments?.length ?? 0

        // email_message upsert on graph_message_id — also stores body + Graph item id for "view original"
        const existing = await tx.selectFrom('emailMessage').where('graphMessageId', '=', graphMessageId).select('id').executeTakeFirst()
        let msgId: string
        const emailPatch = {
          subject: head.subject ?? null,
          sender: head.sender ?? null,
          receivedAt,
          conversationId: head.conversationId ?? null,
          sourceFile: head.sourceFile ?? null,
          attachmentCount,
          graphId: head.graphId ?? null,
          bodyText: bodyE.bodyText ?? null,
          bodyHtml: bodyE.bodyHtml ?? null,
        }
        if (existing) {
          await tx.updateTable('emailMessage').set(emailPatch).where('id', '=', existing.id).execute()
          msgId = existing.id
        } else {
          const inserted = await tx.insertInto('emailMessage').values({
            graphMessageId,
            ...emailPatch,
            status: 'DONE',
          }).output('inserted.id').executeTakeFirstOrThrow()
          msgId = inserted.id
        }

        // attachments: replace-in-place (no natural unique key), but KEEP stored rawBytes when the
        // re-POST omits them (queue RETENTION purge + full re-match — queue #151 / shiptrack #177).
        const priorAtts = existing
          ? await tx
              .selectFrom('emailAttachment')
              .where('messageId', '=', msgId)
              .select(['graphAttachmentId', 'filename', 'sizeBytes', 'rawBytes'])
              .execute()
          : []
        const priorBytes = priorAtts.map((p) => ({
          graphAttachmentId: p.graphAttachmentId ?? null,
          filename: p.filename,
          sizeBytes: p.sizeBytes ?? null,
          rawBytes: (p.rawBytes as Buffer | null) ?? null,
        }))

        await tx.deleteFrom('emailAttachment').where('messageId', '=', msgId).execute()
        if (attE.attachments?.length) {
          await tx.insertInto('emailAttachment').values(
            attE.attachments.map((a) => {
              const carried = resolveAttachmentRawBytes(
                {
                  graphAttachmentId: a.graphAttachmentId,
                  filename: a.filename,
                  sizeBytes: a.sizeBytes ?? null,
                  rawBytesB64: a.rawBytesB64 ?? null,
                },
                priorBytes,
              )
              return {
                messageId: msgId,
                graphAttachmentId: a.graphAttachmentId,
                filename: a.filename,
                declaredMime: a.declaredMime ?? null,
                sizeBytes: a.sizeBytes ?? 0,
                sourceKind: a.sourceKind ?? null,
                // CRITICAL (MSSQL varbinary trap): bare JS null binds as nvarchar — use typed NULL.
                rawBytes: carried
                  ? carried
                  : sql<Buffer | null>`CAST(NULL AS varbinary(max))`,
              }
            }),
          ).execute()
        }

        // parsed_record upsert on (graph_message_id, record_idx) — one per evidence record of this message
        for (const e of entries) {
          const recordIdx = e.recordIdx ?? 0
          const fieldsJson = JSON.stringify(e.fields ?? {})
          const matchKeysJson = JSON.stringify(e.matchKeys ?? {})
          const poNoNorm = evidencePoNorm(e.poNo, e.matchKeys ?? null)
          const existingRec = await tx.selectFrom('parsedRecord')
            .where('graphMessageId', '=', graphMessageId).where('recordIdx', '=', recordIdx)
            .select('id').executeTakeFirst()
          if (existingRec) {
            await tx.updateTable('parsedRecord').set({
              messageId: msgId, poNo: e.poNo ?? null, poNoNorm, emailType: e.emailType ?? null,
              senderType: e.senderType ?? null, mode: e.mode ?? null, fields: fieldsJson, matchKeys: matchKeysJson,
              promptVersion: e.promptVersion ?? null,
            }).where('id', '=', existingRec.id).execute()
          } else {
            await tx.insertInto('parsedRecord').values({
              messageId: msgId, graphMessageId, recordIdx,
              poNo: e.poNo ?? null, poNoNorm, emailType: e.emailType ?? null, senderType: e.senderType ?? null,
              mode: e.mode ?? null, fields: fieldsJson, matchKeys: matchKeysJson, promptVersion: e.promptVersion ?? null,
            }).execute()
          }
        }
      })
    }
  }
}
