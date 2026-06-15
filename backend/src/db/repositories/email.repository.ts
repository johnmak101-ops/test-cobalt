import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
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
   * The attachments of an ingested email, each with its normalized content. The original raw
   * bytes are usually purged (Option-A retention), but the queue keeps the normalized output:
   * `imageBytes` for images AND the pdf passthrough (the real document bytes, with `mime`),
   * `textContent` for docx/xlsx/text/csv/html. That is what the email window renders.
   */
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
}
