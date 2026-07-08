import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/**
 * Reads ingested email from track-system's OWN `ingest` mirror (`ingest.email_message` /
 * `ingest.email_attachment`) for the inbox, "view original", and attachment downloads — no longer
 * the cobalt-queue `queue` schema (that shared-DB seam is gone; see db/schema/ingest.ts). The
 * mirror is fed by `POST /api/decisions` in real ingestion and by the dev seed. Attachment rows
 * hold ORIGINAL bytes only (`raw_bytes`); for real mail these stay null until fetched from
 * Microsoft Graph on demand (a later task) — the dev seed is the only thing populating them today.
 * Callers must still tolerate a miss (nothing ingested yet) by getting null/[] back.
 */
@Injectable()
export class EmailRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** The email keyed by its stable graph_message_id (the same id milestones store). */
  async findIngested(graphMessageId: string) {
    const rows = await this.db
      .select({
        id: schema.ingestEmailMessage.id,
        graphId: schema.ingestEmailMessage.graphId,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        bodyText: schema.ingestEmailMessage.bodyText,
        bodyHtml: schema.ingestEmailMessage.bodyHtml,
        sourceFile: schema.ingestEmailMessage.sourceFile,
        attachmentCount: schema.ingestEmailMessage.attachmentCount,
      })
      .from(schema.ingestEmailMessage)
      .where(eq(schema.ingestEmailMessage.graphMessageId, graphMessageId))
      .limit(1)
    return rows.at(0) ?? null
  }

  /**
   * The attachments of an ingested email — ONE row per file now (`ingest.email_attachment` has no
   * per-normalized-part fan-out like the old `queue_normalized`: no parsed text/image conversions
   * are mirrored here, only the original). `rawBytes` is the file's original bytes when we have
   * them (dev-seed only for now); `graphAttachmentId`/`messageGraphId` ride along on every row so a
   * later on-demand Graph fetch can resolve the original when `rawBytes` is null.
   */
  /** One attachment (by ingest.email_attachment id) — the download endpoint's source. */
  attachmentById(attachmentId: string) {
    return this.db
      .select({
        attachmentId: schema.ingestEmailAttachment.id,
        filename: schema.ingestEmailAttachment.filename,
        sourceKind: schema.ingestEmailAttachment.sourceKind,
        sizeBytes: schema.ingestEmailAttachment.sizeBytes,
        declaredMime: schema.ingestEmailAttachment.declaredMime,
        rawBytes: schema.ingestEmailAttachment.rawBytes,
        graphAttachmentId: schema.ingestEmailAttachment.graphAttachmentId,
        messageGraphId: schema.ingestEmailMessage.graphMessageId,
      })
      .from(schema.ingestEmailAttachment)
      .innerJoin(schema.ingestEmailMessage, eq(schema.ingestEmailMessage.id, schema.ingestEmailAttachment.messageId))
      .where(eq(schema.ingestEmailAttachment.id, attachmentId))
  }

  async attachmentsFor(graphMessageId: string) {
    const [msg] = await this.db
      .select({ id: schema.ingestEmailMessage.id, graphMessageId: schema.ingestEmailMessage.graphMessageId })
      .from(schema.ingestEmailMessage)
      .where(eq(schema.ingestEmailMessage.graphMessageId, graphMessageId))
      .limit(1)
    if (!msg) return []
    return this.db
      .select({
        attachmentId: schema.ingestEmailAttachment.id,
        filename: schema.ingestEmailAttachment.filename,
        sourceKind: schema.ingestEmailAttachment.sourceKind,
        sizeBytes: schema.ingestEmailAttachment.sizeBytes,
        declaredMime: schema.ingestEmailAttachment.declaredMime,
        rawBytes: schema.ingestEmailAttachment.rawBytes,
        graphAttachmentId: schema.ingestEmailAttachment.graphAttachmentId,
        messageGraphId: sql<string>`${msg.graphMessageId}`,
      })
      .from(schema.ingestEmailAttachment)
      .where(eq(schema.ingestEmailAttachment.messageId, msg.id))
  }

  /** The inbox: recent ingested emails (ingest.email_message) with their review-extraction overlay. */
  listInbox(limit = 100) {
    return this.db
      .select({
        id: schema.ingestEmailMessage.id,
        graphMessageId: schema.ingestEmailMessage.graphMessageId,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        status: schema.ingestEmailMessage.status,
        createdAt: schema.ingestEmailMessage.createdAt,
        emailType: schema.reviewEmail.emailType,
        extractedData: schema.reviewEmail.extractedData,
        extractionConfidence: schema.reviewEmail.extractionConfidence,
        reviewStatus: schema.reviewEmail.reviewStatus,
        reviewedBy: schema.reviewEmail.reviewedBy,
        reviewedAt: schema.reviewEmail.reviewedAt,
        reviewNotes: schema.reviewEmail.reviewNotes,
        shipmentId: schema.reviewEmail.shipmentId,
        // the shipment this email actually built (via its milestones) — the real "matched" signal
        matchedShipmentId: sql<
          string | null
        >`(select m.shipment_id from tracking.shipment_milestones m where m.email_message_id = ${schema.ingestEmailMessage.graphMessageId} limit 1)`,
        readAt: schema.emailRead.readAt,
      })
      .from(schema.ingestEmailMessage)
      .leftJoin(schema.reviewEmail, eq(schema.reviewEmail.messageId, schema.ingestEmailMessage.id))
      .leftJoin(schema.emailRead, eq(schema.emailRead.messageId, schema.ingestEmailMessage.id))
      .orderBy(desc(schema.ingestEmailMessage.receivedAt))
      .limit(limit)
  }

  /** Mark an inbox message read (idempotent upsert on the app-owned read-state). */
  async markRead(messageId: string, userId: string | null) {
    await this.db
      .insert(schema.emailRead)
      .values({ messageId, readBy: userId })
      .onConflictDoNothing()
    return { success: true }
  }

  /** Unread = ingested messages with no read-state row. */
  async unreadCount() {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ingestEmailMessage)
      .leftJoin(schema.emailRead, eq(schema.emailRead.messageId, schema.ingestEmailMessage.id))
      .where(sql`${schema.emailRead.messageId} is null`)
    return r?.n ?? 0
  }

  /** Ingestion status for the Settings page: how many emails have been ingested, and when last. */
  async ingestionStatus() {
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${schema.ingestEmailMessage.createdAt})`,
      })
      .from(schema.ingestEmailMessage)
    return { count: row?.count ?? 0, lastAt: row?.lastAt ?? null }
  }

  /** The Graph ingestion watermark/health (ingest.ingest_state) — the REAL last-sync signal. */
  async ingestState() {
    const rows = await this.db
      .select()
      .from(schema.ingestSyncState)
      .orderBy(desc(schema.ingestSyncState.updatedAt))
      .limit(1)
    return rows[0] ?? null
  }

  /** The emails that built a shipment — joined via its milestones' graph message ids (Related Emails). */
  async emailsForShipment(shipmentId: string) {
    return this.db
      .select({
        id: schema.ingestEmailMessage.id,
        graphMessageId: schema.ingestEmailMessage.graphMessageId,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        milestoneType: schema.shipmentEmails.emailType,
      })
      .from(schema.shipmentEmails)
      .innerJoin(schema.ingestEmailMessage, eq(schema.shipmentEmails.graphMessageId, schema.ingestEmailMessage.graphMessageId))
      .where(eq(schema.shipmentEmails.shipmentId, shipmentId))
      .orderBy(desc(schema.ingestEmailMessage.receivedAt))
  }

  /** Emails awaiting human review — the actionable "new" count for the dashboard KPI. */
  async countPendingReview() {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.reviewEmail)
      .where(eq(schema.reviewEmail.reviewStatus, 'NEEDS_REVIEW' as never))
    return r?.n ?? 0
  }

  /** Attachments of an ingested email, keyed by the ingest.email_message id (the inbox row id). */
  attachmentsByMessageId(messageId: string) {
    return this.db
      .select({
        attachmentId: schema.ingestEmailAttachment.id,
        filename: schema.ingestEmailAttachment.filename,
        declaredMime: schema.ingestEmailAttachment.declaredMime,
        sizeBytes: schema.ingestEmailAttachment.sizeBytes,
        createdAt: schema.ingestEmailAttachment.createdAt,
      })
      .from(schema.ingestEmailAttachment)
      .where(eq(schema.ingestEmailAttachment.messageId, messageId))
  }

  /** A single ingested email's full content (for the "view email" panel), keyed by ingest.email_message id. */
  async emailBody(id: string) {
    const [row] = await this.db
      .select({
        id: schema.ingestEmailMessage.id,
        graphMessageId: schema.ingestEmailMessage.graphMessageId,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        bodyText: schema.ingestEmailMessage.bodyText,
        bodyHtml: schema.ingestEmailMessage.bodyHtml,
        toRecipients: schema.ingestEmailMessage.toRecipients,
        ccRecipients: schema.ingestEmailMessage.ccRecipients,
      })
      .from(schema.ingestEmailMessage)
      .where(eq(schema.ingestEmailMessage.id, id))
      .limit(1)
    return row ?? null
  }

  /**
   * Every ingested message in the SAME conversation as `id` (including itself), oldest first, with
   * attachment counts — the email window's thread panel, so a reviewer can see which email in the
   * chain a file actually arrived on (a forwarded MIME lumps prior files onto the latest message).
   */
  async thread(id: string) {
    const [row] = await this.db
      .select({ conversationId: schema.ingestEmailMessage.conversationId })
      .from(schema.ingestEmailMessage)
      .where(eq(schema.ingestEmailMessage.id, id))
      .limit(1)
    const conversationId = row?.conversationId
    if (!conversationId) return []

    return this.db
      .select({
        id: schema.ingestEmailMessage.id,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        attachmentCount: sql<number>`count(${schema.ingestEmailAttachment.id})::int`,
      })
      .from(schema.ingestEmailMessage)
      .leftJoin(schema.ingestEmailAttachment, eq(schema.ingestEmailAttachment.messageId, schema.ingestEmailMessage.id))
      .where(eq(schema.ingestEmailMessage.conversationId, conversationId))
      .groupBy(schema.ingestEmailMessage.id)
      .orderBy(schema.ingestEmailMessage.receivedAt)
  }
}
