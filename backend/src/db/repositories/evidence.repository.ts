import { Inject, Injectable } from '@nestjs/common'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

export interface EvidenceRow {
  id: string
  messageId: string | null
  fields: Record<string, unknown> | null
  matchKeys: Record<string, unknown> | null
  emailType: string | null
  poNo: string | null
  mode: string | null
  receivedAt: Date | null
  conversationId: string | null
  sender: string | null
}

/** Read access to the evidence contract (parsed_record joined with its queue_message). */
@Injectable()
export class EvidenceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Parsed records of specific emails (queue_message ids) — the Change History's per-email replay source. */
  forMessages(messageIds: string[]) {
    if (!messageIds.length) return Promise.resolve([])
    return this.db
      .select({
        messageId: schema.parsedRecord.messageId,
        subject: schema.queueMessage.subject,
        sender: schema.queueMessage.sender,
        receivedAt: schema.queueMessage.receivedAt,
        fields: schema.parsedRecord.fields,
      })
      .from(schema.parsedRecord)
      .innerJoin(schema.queueMessage, eq(schema.parsedRecord.messageId, schema.queueMessage.id))
      .where(inArray(schema.parsedRecord.messageId, messageIds))
  }

  allWithMessage(): Promise<EvidenceRow[]> {
    return this.db
      .select({
        id: schema.parsedRecord.id,
        messageId: schema.parsedRecord.messageId,
        fields: schema.parsedRecord.fields,
        matchKeys: schema.parsedRecord.matchKeys,
        emailType: schema.parsedRecord.emailType,
        poNo: schema.parsedRecord.poNo,
        mode: schema.parsedRecord.mode,
        receivedAt: schema.queueMessage.receivedAt,
        conversationId: schema.queueMessage.conversationId,
        sender: schema.queueMessage.sender,
      })
      .from(schema.parsedRecord)
      .innerJoin(schema.queueMessage, eq(schema.parsedRecord.messageId, schema.queueMessage.id))
  }

  /** Senders of the given source emails, keyed by graph_message_id — used to detect a leg built entirely
   *  from the CVP notification platform (classifyKind rule (c)) on the agent/decisions path, where the DTO
   *  carries no sender. Best-effort: a 2-VM split where queue_message isn't co-located returns fewer rows,
   *  which the caller treats as "not provably platform-only" (never a false demote). */
  sendersByGraphIds(graphMessageIds: string[]): Promise<{ graphMessageId: string | null; sender: string | null }[]> {
    if (!graphMessageIds.length) return Promise.resolve([])
    return this.db
      .select({ graphMessageId: schema.queueMessage.graphMessageId, sender: schema.queueMessage.sender })
      .from(schema.queueMessage)
      .where(inArray(schema.queueMessage.graphMessageId, graphMessageIds))
  }
}
