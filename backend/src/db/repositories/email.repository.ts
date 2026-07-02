import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/**
 * Reads an ingested email from the shared `queue` schema for "view original". In the same-host
 * deployment the queue tables live alongside tracking, so we can return the actual email. In the
 * 2-VM split they live on the Agent VM — callers must tolerate this throwing / returning null.
 */
@Injectable()
export class EmailRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** The email keyed by its stable graph_message_id (the same id milestones store). */
  async findIngested(graphMessageId: string) {
    const rows = await this.db
      .select({
        id: schema.queueMessage.id,
        graphId: schema.queueMessage.graphId,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        bodyText: schema.queueMessage.bodyText,
        bodyHtml: schema.queueMessage.bodyHtml,
        sourceFile: schema.queueMessage.sourceFile,
        attachmentCount: schema.queueMessage.attachmentCount,
      })
      .from(schema.queueMessage)
      .where(eq(schema.queueMessage.graphMessageId, graphMessageId))
      .limit(1)
    return rows.at(0) ?? null
  }

  /**
   * The attachments of an ingested email. For human verification we serve the ORIGINAL document:
   * `rawBytes` holds the real binary for office formats (docx/xlsx/doc/rtf) so a reviewer downloads
   * and opens the true file; for images and PDF the `imageBytes` passthrough already IS the original.
   * `textContent` (the parsed html/csv) is only a fallback for text-native attachments — never the
   * thing we hand a human to verify an office doc. Raw bytes may be purged later (Option-A retention).
   */
  /** One attachment's rows (per normalized part) by queue_attachment id — the download endpoint's source. */
  attachmentById(attachmentId: string) {
    return this.db
      .select({
        attachmentId: schema.queueAttachment.id,
        filename: schema.queueAttachment.filename,
        sourceKind: schema.queueAttachment.sourceKind,
        sizeBytes: schema.queueAttachment.sizeBytes,
        declaredMime: schema.queueAttachment.declaredMime,
        rawBytes: schema.queueAttachment.rawBytes,
        kind: schema.queueNormalized.kind,
        mime: schema.queueNormalized.mime,
        label: schema.queueNormalized.label,
        textContent: schema.queueNormalized.textContent,
        imageBytes: schema.queueNormalized.imageBytes,
      })
      .from(schema.queueAttachment)
      .leftJoin(schema.queueNormalized, eq(schema.queueNormalized.attachmentId, schema.queueAttachment.id))
      .where(eq(schema.queueAttachment.id, attachmentId))
  }

  async attachmentsFor(graphMessageId: string) {
    const msg = await this.db
      .select({ id: schema.queueMessage.id })
      .from(schema.queueMessage)
      .where(eq(schema.queueMessage.graphMessageId, graphMessageId))
      .limit(1)
    const messageId = msg.at(0)?.id
    if (!messageId) return []

    return this.db
      .select({
        attachmentId: schema.queueAttachment.id,
        filename: schema.queueAttachment.filename,
        sourceKind: schema.queueAttachment.sourceKind,
        sizeBytes: schema.queueAttachment.sizeBytes,
        declaredMime: schema.queueAttachment.declaredMime,
        rawBytes: schema.queueAttachment.rawBytes,
        kind: schema.queueNormalized.kind,
        mime: schema.queueNormalized.mime,
        label: schema.queueNormalized.label,
        textContent: schema.queueNormalized.textContent,
        imageBytes: schema.queueNormalized.imageBytes,
      })
      .from(schema.queueAttachment)
      .leftJoin(schema.queueNormalized, eq(schema.queueNormalized.attachmentId, schema.queueAttachment.id))
      .where(eq(schema.queueAttachment.messageId, messageId))
  }

  /** The inbox: recent ingested emails (queue_message) with their review-extraction overlay. */
  listInbox(limit = 100) {
    return this.db
      .select({
        id: schema.queueMessage.id,
        graphMessageId: schema.queueMessage.graphMessageId,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        status: schema.queueMessage.status,
        createdAt: schema.queueMessage.createdAt,
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
        >`(select m.shipment_id from tracking.shipment_milestones m where m.email_message_id = ${schema.queueMessage.graphMessageId} limit 1)`,
        readAt: schema.emailRead.readAt,
      })
      .from(schema.queueMessage)
      .leftJoin(schema.reviewEmail, eq(schema.reviewEmail.messageId, schema.queueMessage.id))
      .leftJoin(schema.emailRead, eq(schema.emailRead.messageId, schema.queueMessage.id))
      .orderBy(desc(schema.queueMessage.receivedAt))
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
      .from(schema.queueMessage)
      .leftJoin(schema.emailRead, eq(schema.emailRead.messageId, schema.queueMessage.id))
      .where(sql`${schema.emailRead.messageId} is null`)
    return r?.n ?? 0
  }

  /** Ingestion status for the Settings page: how many emails have been ingested, and when last. */
  async ingestionStatus() {
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date | null>`max(${schema.queueMessage.createdAt})`,
      })
      .from(schema.queueMessage)
    return { count: row?.count ?? 0, lastAt: row?.lastAt ?? null }
  }

  /** The Graph ingestion watermark/health (queue.ingest_state) — the REAL last-sync signal. */
  async ingestState() {
    const rows = await this.db
      .select()
      .from(schema.ingestState)
      .orderBy(desc(schema.ingestState.updatedAt))
      .limit(1)
    return rows[0] ?? null
  }

  /** The emails that built a shipment — joined via its milestones' graph message ids (Related Emails). */
  async emailsForShipment(shipmentId: string) {
    return this.db
      .select({
        id: schema.queueMessage.id,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        milestoneType: schema.shipmentEmails.emailType,
      })
      .from(schema.shipmentEmails)
      .innerJoin(schema.queueMessage, eq(schema.shipmentEmails.graphMessageId, schema.queueMessage.graphMessageId))
      .where(eq(schema.shipmentEmails.shipmentId, shipmentId))
      .orderBy(desc(schema.queueMessage.receivedAt))
  }

  /** Emails awaiting human review — the actionable "new" count for the dashboard KPI. */
  async countPendingReview() {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.reviewEmail)
      .where(eq(schema.reviewEmail.reviewStatus, 'NEEDS_REVIEW' as never))
    return r?.n ?? 0
  }

  /** Attachments of an ingested email, keyed by the queue_message id (the inbox row id). */
  attachmentsByMessageId(messageId: string) {
    return this.db
      .select({
        attachmentId: schema.queueAttachment.id,
        filename: schema.queueAttachment.filename,
        declaredMime: schema.queueAttachment.declaredMime,
        sizeBytes: schema.queueAttachment.sizeBytes,
        createdAt: schema.queueAttachment.createdAt,
      })
      .from(schema.queueAttachment)
      .where(eq(schema.queueAttachment.messageId, messageId))
  }

  /** A single ingested email's full content (for the "view email" panel), keyed by queue_message id. */
  async emailBody(id: string) {
    const [row] = await this.db
      .select({
        id: schema.queueMessage.id,
        graphMessageId: schema.queueMessage.graphMessageId,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        bodyText: schema.queueMessage.bodyText,
        bodyHtml: schema.queueMessage.bodyHtml,
        toRecipients: schema.queueMessage.toRecipients,
        ccRecipients: schema.queueMessage.ccRecipients,
      })
      .from(schema.queueMessage)
      .where(eq(schema.queueMessage.id, id))
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
      .select({ conversationId: schema.queueMessage.conversationId })
      .from(schema.queueMessage)
      .where(eq(schema.queueMessage.id, id))
      .limit(1)
    const conversationId = row?.conversationId
    if (!conversationId) return []

    return this.db
      .select({
        id: schema.queueMessage.id,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        attachmentCount: sql<number>`count(${schema.queueAttachment.id})::int`,
      })
      .from(schema.queueMessage)
      .leftJoin(schema.queueAttachment, eq(schema.queueAttachment.messageId, schema.queueMessage.id))
      .where(eq(schema.queueMessage.conversationId, conversationId))
      .groupBy(schema.queueMessage.id)
      .orderBy(schema.queueMessage.receivedAt)
  }
}
