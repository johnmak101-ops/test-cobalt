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
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        bodyText: schema.queueMessage.bodyText,
        sourceFile: schema.queueMessage.sourceFile,
        attachmentCount: schema.queueMessage.attachmentCount,
      })
      .from(schema.queueMessage)
      .where(eq(schema.queueMessage.graphMessageId, graphMessageId))
      .limit(1)
    return rows.at(0) ?? null
  }
}
