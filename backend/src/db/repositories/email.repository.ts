import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Kysely/SQL Server port of EmailRepository. Reads ingested email from track-system's OWN `ingest`
 *  mirror (`email_message` / `email_attachment`) for the inbox, "view original", and attachment
 *  downloads. The mirror is fed by `POST /api/decisions` in real ingestion and by the dev seed.
 *
 *  Postgres → MSSQL notes:
 *  - `returning` not needed (markRead uses check-then-insert; email_message PK is codegen'd).
 *  - `count(*)::int` → `count(*)` cast to number client-side.
 *  - `onConflictDoNothing` (email_read PK) → check-then-insert (idempotent upsert).
 *  - The Postgres-qualified `tracking.shipment_milestones` reference in listInbox's correlated
 *    subquery → unqualified `shipment_milestones` (the T-SQL schema is `dbo`, one schema). */
@Injectable()
export class EmailRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /** The email keyed by its stable graph_message_id (the same id milestones store). */
  async findIngested(graphMessageId: string) {
    const row = await this.db
      .selectFrom('emailMessage')
      .where('graphMessageId', '=', graphMessageId)
      .select([
        'id', 'graphId', 'subject', 'sender', 'receivedAt', 'bodyText', 'bodyHtml',
        'sourceFile', 'attachmentCount',
      ])
      .executeTakeFirst()
    return row ?? null
  }

  /** One attachment (by email_attachment id) — the download endpoint's source. */
  attachmentById(attachmentId: string) {
    return this.db
      .selectFrom('emailAttachment')
      .innerJoin('emailMessage', 'emailMessage.id', 'emailAttachment.messageId')
      .where('emailAttachment.id', '=', attachmentId)
      .select([
        'emailAttachment.id as attachmentId', 'emailAttachment.filename as filename',
        'emailAttachment.sourceKind as sourceKind', 'emailAttachment.sizeBytes as sizeBytes',
        'emailAttachment.declaredMime as declaredMime', 'emailAttachment.rawBytes as rawBytes',
        'emailAttachment.graphAttachmentId as graphAttachmentId',
        'emailMessage.graphMessageId as messageGraphId',
      ])
      .execute()
  }

  async attachmentsFor(graphMessageId: string) {
    const msg = await this.db
      .selectFrom('emailMessage')
      .where('graphMessageId', '=', graphMessageId)
      .select(['id', 'graphMessageId'])
      .executeTakeFirst()
    if (!msg) return []
    return this.db
      .selectFrom('emailAttachment')
      .where('messageId', '=', msg.id)
      .select([
        'id as attachmentId', 'filename', 'sourceKind', 'sizeBytes', 'declaredMime', 'rawBytes',
        'graphAttachmentId',
        sql<string>`${msg.graphMessageId}`.as('messageGraphId'),
      ])
      .execute()
  }

  /** The inbox: recent ingested emails with their review-extraction overlay.
   *  Kysely's MssqlDialect (0.29) emits `limit` verbatim (not TOP/OFFSET-FETCH), so the row cap is applied
   *  via a `TOP N` raw fragment in the select list. */
  async listInbox(limit = 100) {
    const capped = Math.max(1, Math.floor(limit))
    return this.db
      .selectFrom('emailMessage')
      .leftJoin('reviewEmail', 'reviewEmail.messageId', 'emailMessage.id')
      .leftJoin('emailRead', 'emailRead.messageId', 'emailMessage.id')
      .orderBy('emailMessage.receivedAt', 'desc')
      // TOP must be the first token after SELECT; emit it via a zero-width raw select alias so Kysely
      // places it in the select list. We then read it back and discard — simplest is a subquery wrap.
      .select([
        'emailMessage.id as id', 'emailMessage.graphMessageId as graphMessageId',
        'emailMessage.subject as subject', 'emailMessage.sender as sender',
        'emailMessage.receivedAt as receivedAt', 'emailMessage.status as status',
        'emailMessage.createdAt as createdAt',
        'reviewEmail.emailType as emailType', 'reviewEmail.extractedData as extractedData',
        'reviewEmail.extractionConfidence as extractionConfidence', 'reviewEmail.reviewStatus as reviewStatus',
        'reviewEmail.reviewedBy as reviewedBy', 'reviewEmail.reviewedAt as reviewedAt',
        'reviewEmail.reviewNotes as reviewNotes', 'reviewEmail.shipmentId as shipmentId',
        sql<string | null>`(select top 1 m.shipment_id from shipment_milestones m where m.email_message_id = ${sql.ref('emailMessage.graphMessageId')})`.as('matchedShipmentId'),
        'emailRead.readAt as readAt',
      ])
      .modifyFront(sql`top ${sql.lit(capped)}`)
      .execute()
  }

  /** Mark an inbox message read (idempotent upsert on the app-owned read-state). */
  async markRead(messageId: string, userId: string | null) {
    const existing = await this.db
      .selectFrom('emailRead')
      .where('messageId', '=', messageId)
      .select('messageId')
      .executeTakeFirst()
    if (!existing) {
      try {
        await this.db.insertInto('emailRead').values({ messageId, readBy: userId }).execute()
      } catch (e) {
        // PK violation (message_id) → a concurrent insert won the race; idempotent
        if (!/unique|duplicate|primary/i.test((e as Error).message)) throw e
      }
    }
    return { success: true }
  }

  /** Unread = ingested messages with no read-state row. */
  async unreadCount() {
    const row = await this.db
      .selectFrom('emailMessage')
      .leftJoin('emailRead', 'emailRead.messageId', 'emailMessage.id')
      .where('emailRead.messageId', 'is', null)
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  /** Ingestion status for the Settings page: how many emails have been ingested, and when last. */
  async ingestionStatus() {
    const row = await this.db
      .selectFrom('emailMessage')
      .select([
        sql<number>`count(*)`.as('count'),
        sql<Date | null>`max(${sql.ref('emailMessage.createdAt')})`.as('lastAt'),
      ])
      .executeTakeFirst()
    return { count: Number(row?.count ?? 0), lastAt: row?.lastAt ?? null }
  }

  /** The Graph ingestion watermark/health (ingest_state) — the REAL last-sync signal. */
  async ingestState() {
    const row = await this.db
      .selectFrom('ingestState')
      .orderBy('updatedAt', 'desc')
      .selectAll()
      .executeTakeFirst()
    return row ?? null
  }

  /** The emails that built a shipment (Related Emails / Alerts & Emails).
   *  Join key may be either the RFC Message-ID (`email_message.graph_message_id`) OR the Graph item id
   *  (`email_message.graph_id`) — older commits stored AAMk… in shipment_emails after matcher started
   *  sending real Graph ids on events.graphId. */
  async emailsForShipment(shipmentId: string) {
    return this.db
      .selectFrom('shipmentEmails')
      .innerJoin('emailMessage', (join) =>
        join.on((eb) =>
          eb.or([
            eb('shipmentEmails.graphMessageId', '=', eb.ref('emailMessage.graphMessageId')),
            eb('shipmentEmails.graphMessageId', '=', eb.ref('emailMessage.graphId')),
          ]),
        ),
      )
      .where('shipmentEmails.shipmentId', '=', shipmentId)
      .orderBy('emailMessage.receivedAt', 'desc')
      .select([
        'emailMessage.id as id', 'emailMessage.graphMessageId as graphMessageId',
        'emailMessage.subject as subject', 'emailMessage.sender as sender',
        'emailMessage.receivedAt as receivedAt', 'shipmentEmails.emailType as milestoneType',
      ])
      .execute()
  }

  /** emailsForShipment for many shipments in ONE query (shipmentId -> emails, newest first) — replaces the
   *  per-leg emailsForShipment in the alert evaluator's A7 loop. */
  async emailsForShipments(shipmentIds: string[]) {
    const rows = shipmentIds.length
      ? await this.db
          .selectFrom('shipmentEmails')
          .innerJoin('emailMessage', (join) =>
            join.on((eb) =>
              eb.or([
                eb('shipmentEmails.graphMessageId', '=', eb.ref('emailMessage.graphMessageId')),
                eb('shipmentEmails.graphMessageId', '=', eb.ref('emailMessage.graphId')),
              ]),
            ),
          )
          .where('shipmentEmails.shipmentId', 'in', shipmentIds)
          .orderBy('emailMessage.receivedAt', 'desc')
          .select([
            'shipmentEmails.shipmentId as shipmentId', 'emailMessage.id as id',
            'emailMessage.graphMessageId as graphMessageId', 'emailMessage.subject as subject',
            'emailMessage.sender as sender', 'emailMessage.receivedAt as receivedAt',
            'shipmentEmails.emailType as milestoneType',
          ])
          .execute()
      : []
    const map = new Map<string, Array<Omit<(typeof rows)[number], 'shipmentId'>>>()
    for (const { shipmentId, ...email } of rows) {
      const arr = map.get(shipmentId)
      if (arr) arr.push(email)
      else map.set(shipmentId, [email])
    }
    return map
  }

  /** Emails awaiting human review — the actionable "new" count for the dashboard KPI. */
  async countPendingReview() {
    const row = await this.db
      .selectFrom('reviewEmail')
      .where('reviewStatus', '=', 'NEEDS_REVIEW')
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  /** Attachments of an ingested email, keyed by the email_message id (the inbox row id). */
  attachmentsByMessageId(messageId: string) {
    return this.db
      .selectFrom('emailAttachment')
      .where('messageId', '=', messageId)
      .select([
        'id as attachmentId', 'filename', 'declaredMime', 'sizeBytes', 'createdAt',
      ])
      .execute()
  }

  /** A single ingested email's full content (for the "view email" panel), keyed by email_message id. */
  async emailBody(id: string) {
    const row = await this.db
      .selectFrom('emailMessage')
      .where('id', '=', id)
      .select([
        'id', 'graphMessageId', 'subject', 'sender', 'receivedAt', 'bodyText', 'bodyHtml',
        'toRecipients', 'ccRecipients',
      ])
      .executeTakeFirst()
    return row ?? null
  }

  /**
   * Every ingested message in the SAME conversation as `id` (including itself), oldest first, with
   * attachment counts — the email window's thread panel, so a reviewer can see which email in the
   * chain a file actually arrived on (a forwarded MIME lumps prior files onto the latest message).
   */
  async thread(id: string) {
    const row = await this.db
      .selectFrom('emailMessage')
      .where('id', '=', id)
      .select('conversationId')
      .executeTakeFirst()
    const conversationId = row?.conversationId
    if (!conversationId) return []

    return this.db
      .selectFrom('emailMessage')
      .leftJoin('emailAttachment', 'emailAttachment.messageId', 'emailMessage.id')
      .where('emailMessage.conversationId', '=', conversationId)
      // SQL Server requires every non-aggregated selected column in GROUP BY (no Postgres functional-
      // dependency shortcut). Group by the email's own columns; count() aggregates the attachment join.
      .groupBy([
        'emailMessage.id', 'emailMessage.subject', 'emailMessage.sender', 'emailMessage.receivedAt',
      ])
      .orderBy('emailMessage.receivedAt', 'asc')
      .select([
        'emailMessage.id as id', 'emailMessage.subject as subject', 'emailMessage.sender as sender',
        'emailMessage.receivedAt as receivedAt',
        sql<number>`count(${sql.ref('emailAttachment.id')})`.as('attachmentCount'),
      ])
      .execute()
  }
}
